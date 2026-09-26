#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { buildClassificationInput } from './menu-scoring-input.mjs';
import { PROMPT_VERSION } from './menu-scoring-version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'public', 'data');
const rubricPath = join(root, 'config', 'menu-scoring-rubric.json');
const RESULT_SCHEMA_VERSION = 'menu-item-classification-v2';
const CODEX_MODEL = 'gpt-6-luna';
const REASONING_EFFORT = process.env.CODEX_SCORE_REASONING_EFFORT ?? 'medium';
const DEFAULT_CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;
const CODEX_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_ITEMS_PER_CALL = 40;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const limitArg = args.find((arg) => arg.startsWith('--limit='));
const onlyArg = args.find((arg) => arg.startsWith('--only='));
const limit = limitArg ? Number.parseInt(limitArg.slice('--limit='.length), 10) : Infinity;
const onlyId = onlyArg?.slice('--only='.length);
const concurrency = Number.parseInt(process.env.CODEX_SCORE_CONCURRENCY ?? `${DEFAULT_CONCURRENCY}`, 10);

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(tempPath, serialize(value));
  try {
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}

function validateArgs() {
  for (const arg of args) {
    if (arg !== '--dry-run' && !arg.startsWith('--limit=') && !arg.startsWith('--only=')) {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (limitArg && (!Number.isInteger(limit) || limit < 1)) {
    throw new Error('--limit must be a positive integer');
  }
  if (onlyArg && !/^[A-Za-z0-9_-]+$/.test(onlyId ?? '')) {
    throw new Error('--only must contain a valid restaurant ID');
  }
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 25) {
    throw new Error('CODEX_SCORE_CONCURRENCY must be an integer from 1 to 25');
  }
  if (!['low', 'medium', 'high'].includes(REASONING_EFFORT)) {
    throw new Error('CODEX_SCORE_REASONING_EFFORT must be low, medium, or high');
  }
}

function buildPrompt(items, criteria) {
  const payload = {
    criteria: criteria.map(({ id, description }, i) => ({ i, id, description })),
    items: items.map((item, i) => ({ i, name: item.name, description: item.description, tags: item.tags })),
  };
  return [
    'Classify each menu item independently against every numbered food criterion. The result is binary: a criterion is present only when this item supports it; otherwise it is absent. There is no uncertain status.',
    'Read each item name and description together as one dish. Tags are part of that same item. Use only the supplied item text; do not infer ingredients from cuisine or likely recipes.',
    'Return one row for every input item, in order. A row is [item index, positive findings]. A positive finding is [criterion index, exact evidence quote]. List each present criterion at most once per item, even when multiple ingredients match it. Use an empty findings array when no criterion is present. Do not return absent findings, menu structure, scores, or explanations.',
    'Each evidence quote must be an exact substring of that same item name, description, or tag and must clearly identify the ingredient or vegetarian mark. Do not quote a partial word or combine text from separate fields or items.',
    'Ikura and other fish roe count as fish, never shellfish. Shellfish means crustaceans or molluscs only.',
    'The literal phrase "catch of the day" counts as fish even when the species is not named. Use that phrase as evidence. It is not shellfish unless a crustacean or mollusc is also named.',
    'Vegetarian is present only when the item is explicitly marked vegetarian or its listed ingredients clearly support a complete vegetarian dish. A side, sauce, or garnish alone is insufficient.',
    'Return JSON matching the output schema. Example shape: {"items":[[0,[[0,"salmon"],[3,"bacon"]]],[1,[]]]}. The example is structural only; classify the actual input below.',
    'Input JSON:',
    JSON.stringify(payload),
  ].join('\n\n');
}

function buildOutputSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['items'],
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'array',
          items: {
            anyOf: [
              { type: 'integer' },
              { type: 'array', items: { type: 'array', items: { anyOf: [{ type: 'integer' }, { type: 'string' }] } } },
            ],
          },
        },
      },
    },
  };
}

function validateClassification(output, items, criteria) {
  if (!output || Object.keys(output).length !== 1 || !Array.isArray(output.items) || output.items.length !== items.length) {
    throw new TypeError(`Expected exactly ${items.length} classified item rows`);
  }

  return output.items.map((row, itemIndex) => {
    if (!Array.isArray(row) || row.length !== 2 || row[0] !== itemIndex || !Array.isArray(row[1])) {
      throw new TypeError(`Item row ${itemIndex} is missing, out of order, or malformed`);
    }
    const item = items[itemIndex];
    const sourceText = [item.name, item.description, ...item.tags].filter(Boolean).join('\n').toLocaleLowerCase();
    const classifications = Object.fromEntries(criteria.map(({ id }) => [id, { status: 'absent', evidence: null }]));
    const seen = new Set();
    for (const finding of row[1]) {
      if (!Array.isArray(finding) || finding.length !== 2) {
        throw new TypeError(`Item ${itemIndex} has a malformed positive finding`);
      }
      const [criterionIndex, rawEvidence] = finding;
      if (!Number.isInteger(criterionIndex) || criterionIndex < 0 || criterionIndex >= criteria.length) {
        throw new TypeError(`Item ${itemIndex} has an invalid criterion index: ${JSON.stringify(finding).slice(0, 160)}`);
      }
      if (typeof rawEvidence !== 'string' || !rawEvidence.trim()) {
        throw new TypeError(`Item ${itemIndex} has evidence missing from its own text for ${criteria[criterionIndex].id}`);
      }
      let evidence = rawEvidence.trim();
      if (!sourceText.includes(evidence.toLocaleLowerCase()) && criteria[criterionIndex].id === 'vegetarian') {
        const marker = [item.name, item.description, ...item.tags]
          .map((field) => field.match(/\([^)]*\bV\b[^)]*\)|\[\s*V\s*\]|\bvegetarian\b/i)?.[0])
          .find(Boolean);
        if (marker) evidence = marker;
      }
      if (!sourceText.includes(evidence.toLocaleLowerCase())) {
        throw new TypeError(`Item ${itemIndex} has evidence missing from its own text for ${criteria[criterionIndex].id}`);
      }
      if (!seen.has(criterionIndex)) {
        seen.add(criterionIndex);
        classifications[criteria[criterionIndex].id] = { status: 'present', evidence };
      }
    }
    return classifications;
  });
}

function parseModelResponse(content) {
  const cleaned = String(content).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

async function runCodex(prompt, schema, timeoutMs = CODEX_TIMEOUT_MS) {
  const workDir = await mkdtemp(join(tmpdir(), 'restaurant-week-codex-'));
  const schemaPath = join(workDir, 'output-schema.json');
  const outputPath = join(workDir, 'last-message.json');
  await writeFile(schemaPath, serialize(schema));

  const command = process.env.CODEX_CLI_PATH || (process.platform === 'win32' ? 'codex.cmd' : 'codex');
  const cliArgs = [
    'exec',
    '--ephemeral',
    '--model', CODEX_MODEL,
    '-c', `model_reasoning_effort="${REASONING_EFFORT}"`,
    '--sandbox', 'read-only',
    '--skip-git-repo-check',
    '--cd', workDir,
    '--output-schema', schemaPath,
    '--output-last-message', outputPath,
    '-',
  ];

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(command, cliArgs, {
        cwd: workDir,
        env: process.env,
        shell: process.platform === 'win32',
        windowsHide: true,
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Codex CLI timed out after ${Math.round(timeoutMs / 1000)} seconds`));
      }, timeoutMs);

      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk) => {
        stderr = `${stderr}${chunk}`.slice(-12000);
      });
      child.on('error', (error) => {
        clearTimeout(timer);
        reject(new Error(`Could not start Codex CLI (${command}): ${error.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`Codex CLI exited with code ${code}: ${stderr.trim() || 'no error details'}`));
      });
      child.stdin.on('error', (error) => {
        if (error.code !== 'EPIPE') {
          clearTimeout(timer);
          reject(error);
        }
      });
      child.stdin.end(prompt, 'utf8');
    });
    return parseModelResponse(await readFile(outputPath, 'utf8'));
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function classifyInput(items, criteria, restaurantId, batchNumber, batchCount) {
  const prompt = buildPrompt(items, criteria);
  const schema = buildOutputSchema();
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const startedAt = Date.now();
    try {
      const rawOutput = await runCodex(prompt, schema);
      validateClassification(rawOutput, items, criteria);
      return rawOutput;
    } catch (error) {
      lastError = error;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`Codex attempt ${attempt}/${MAX_ATTEMPTS} failed for ${restaurantId}, batch ${batchNumber}/${batchCount} after ${seconds}s: ${error.message}`);
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  throw new Error(`Batch ${batchNumber}/${batchCount} failed for ${restaurantId}: ${lastError.message}`);
}

async function classifyMenu(input, progressPath) {
  const sourceItems = input.meals.flatMap((meal) => meal.sections.flatMap((section) => section.items));
  const batchCount = Math.ceil(sourceItems.length / MAX_ITEMS_PER_CALL);
  if (batchCount > 1) {
    console.log(`Classifying ${input.restaurantId}'s ${sourceItems.length} items in ${batchCount} batches.`);
  }

  const signature = {
    restaurantId: input.restaurantId,
    menuHash: input.menuHash,
    rubricVersion: input.rubricVersion,
    promptVersion: PROMPT_VERSION,
    schemaVersion: RESULT_SCHEMA_VERSION,
    model: CODEX_MODEL,
    reasoningEffort: REASONING_EFFORT,
    itemCount: sourceItems.length,
    batchSize: MAX_ITEMS_PER_CALL,
  };
  let savedBatches = [];
  try {
    const progress = await readJson(progressPath);
    if (Object.entries(signature).every(([key, value]) => progress[key] === value) && Array.isArray(progress.batches)) {
      savedBatches = progress.batches;
    }
  } catch { /* No matching local progress file. */ }

  const findings = [];
  for (let start = 0; start < sourceItems.length; start += MAX_ITEMS_PER_CALL) {
    const batchNumber = Math.floor(start / MAX_ITEMS_PER_CALL) + 1;
    const batch = sourceItems.slice(start, start + MAX_ITEMS_PER_CALL);
    let output = savedBatches[batchNumber - 1];
    if (output) {
      try {
        validateClassification(output, batch, input.criteria);
        console.log(`Reusing ${input.restaurantId} batch ${batchNumber}/${batchCount}.`);
      } catch {
        savedBatches = savedBatches.slice(0, batchNumber - 1);
        output = null;
      }
    }
    if (!output) {
      savedBatches = savedBatches.slice(0, batchNumber - 1);
      output = await classifyInput(batch, input.criteria, input.restaurantId, batchNumber, batchCount);
      savedBatches.push(output);
      await writeJsonAtomic(progressPath, { ...signature, batches: savedBatches });
    }
    findings.push(...validateClassification(output, batch, input.criteria));
  }

  let itemPosition = 0;
  return {
    meals: input.meals.map((meal) => ({
      mealIndex: meal.mealIndex,
      mealType: meal.mealType,
      title: meal.title,
      sections: meal.sections.map((section) => ({
        sectionIndex: section.sectionIndex,
        name: section.name,
        items: section.items.map((item) => ({
          itemIndex: item.itemIndex,
          sourceItemId: item.sourceItemId,
          classifications: findings[itemPosition++],
        })),
      })),
    })),
  };
}

async function main() {
  validateArgs();
  const rubric = await readJson(rubricPath);
  const metadataPath = join(dataDir, 'menus', 'metadata.json');
  const scoresDir = join(dataDir, 'scores');
  const metadata = await readJson(metadataPath);
  const scoreIndexPath = join(scoresDir, 'index.json');
  const scoreIndex = await readJson(scoreIndexPath);
  scoreIndex.byRestaurantId ??= {};
  const restaurants = await readJson(join(dataDir, 'restaurants', 'restaurants.json'));
  const restaurantById = new Map(restaurants.map((restaurant) => [String(restaurant.id), restaurant]));

  const candidates = Object.entries(metadata.menus).filter(([id]) => !onlyId || id === onlyId);
  if (onlyId && !metadata.menus[onlyId]) throw new Error(`Restaurant ID ${onlyId} is not in the current menu dataset`);
  const queue = [];
  for (const [id, menuMeta] of candidates) {
    const existing = scoreIndex.byRestaurantId[id];
    let valid = existing?.menuHash === menuMeta.menuHash
      && existing?.rubricVersion === rubric.version
      && existing?.promptVersion === PROMPT_VERSION
      && existing?.schemaVersion === RESULT_SCHEMA_VERSION
      && existing?.model === CODEX_MODEL
      && existing?.reasoningEffort === REASONING_EFFORT
      && typeof existing?.classificationFile === 'string'
      && !existing.classificationFile.includes('..')
      && !existing.classificationFile.includes('/')
      && !existing.classificationFile.includes('\\');
    if (valid) {
      try {
        const saved = await readJson(join(scoresDir, existing.classificationFile));
        valid = saved.schemaVersion === RESULT_SCHEMA_VERSION
          && saved.menuHash === menuMeta.menuHash
          && saved.rubricVersion === rubric.version
          && saved.promptVersion === PROMPT_VERSION
          && saved.model === CODEX_MODEL
          && saved.reasoningEffort === REASONING_EFFORT;
      } catch {
        valid = false;
      }
    }
    if (!valid) queue.push({ id, menuMeta, restaurant: restaurantById.get(id) });
  }

  const selected = queue.slice(0, limit);
  console.log(`${queue.length} menu(s) need item classification for ${rubric.version}; ${queue.length - selected.length} are outside this run's limit.`);
  for (const entry of selected) {
    console.log(`Pending: ${entry.restaurant?.name ?? entry.id} (${entry.id}), menu hash ${entry.menuMeta.menuHash}`);
  }
  if (dryRun || selected.length === 0) {
    if (dryRun) console.log('Dry run: no Codex CLI calls were made and generated data was not changed.');
    return;
  }

  const modelFailures = [];
  let completed = 0;
  let writeChain = Promise.resolve();
  await mkdir(scoresDir, { recursive: true });

  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < selected.length; index += concurrency) {
      const { id, menuMeta, restaurant } = selected[index];
      try {
        const menu = await readJson(join(dataDir, 'menus', menuMeta.file));
        const input = buildClassificationInput(id, menuMeta.menuHash, rubric, menu);
        const progressPath = join(root, '.cache', 'menu-scoring', `${id}.json`);
        const classified = await classifyMenu(input, progressPath);
        const classificationFile = `classification-${id}.json`;
        const result = {
          schemaVersion: RESULT_SCHEMA_VERSION,
          analysisType: 'menu-item-classifications',
          restaurantId: restaurant?.id ?? id,
          menuHash: menuMeta.menuHash,
          hashVersion: menuMeta.hashVersion,
          rubricVersion: rubric.version,
          promptVersion: PROMPT_VERSION,
          model: CODEX_MODEL,
          reasoningEffort: REASONING_EFFORT,
          generatedAt: new Date().toISOString(),
          meals: classified.meals,
        };
        await writeJsonAtomic(join(scoresDir, classificationFile), result);

        writeChain = writeChain.then(async () => {
          scoreIndex.byRestaurantId[id] = {
            restaurantId: restaurant?.id ?? id,
            menuHash: menuMeta.menuHash,
            rubricVersion: rubric.version,
            promptVersion: PROMPT_VERSION,
            schemaVersion: RESULT_SCHEMA_VERSION,
            model: CODEX_MODEL,
            reasoningEffort: REASONING_EFFORT,
            classificationFile,
          };
          metadata.menus[id].analysisStatus = 'classified';
          metadata.menus[id].rubricVersion = rubric.version;
          metadata.menus[id].promptVersion = PROMPT_VERSION;
          metadata.menus[id].classificationFile = classificationFile;
          await writeJsonAtomic(scoreIndexPath, scoreIndex);
          await writeJsonAtomic(metadataPath, metadata);
        });
        await writeChain;
        await rm(progressPath, { force: true });
        await rm(join(scoresDir, 'failures', `${id}.json`), { force: true });
        completed += 1;
        const itemCount = input.meals.reduce((sum, meal) => sum + meal.sections.reduce((sectionSum, section) => sectionSum + section.items.length, 0), 0);
        console.log(`Classified ${completed}/${selected.length}: ${restaurant?.name ?? id} (${id}), ${itemCount} menu items; no aggregate scores stored.`);
      } catch (error) {
        const failure = {
          restaurantId: restaurant?.id ?? id,
          menuHash: menuMeta.menuHash,
          rubricVersion: rubric.version,
          promptVersion: PROMPT_VERSION,
          failedAt: new Date().toISOString(),
          error: error.message,
        };
        modelFailures.push(failure);
        await writeJsonAtomic(join(scoresDir, 'failures', `${id}.json`), failure);
        console.error(`Classification failed for ${restaurant?.name ?? id}: ${error.message}`);
      }
    }
  }));

  const manifestPath = join(dataDir, 'manifest.json');
  const manifest = await readJson(manifestPath);
  delete manifest.scoredMenuCount;
  delete manifest.needsScoringCount;
  manifest.rubricVersion = rubric.version;
  manifest.promptVersion = PROMPT_VERSION;
  manifest.classifiedMenuCount = Object.values(scoreIndex.byRestaurantId).filter((entry) => (
    entry.rubricVersion === rubric.version && entry.promptVersion === PROMPT_VERSION
  )).length;
  manifest.needsClassificationCount = Math.max(0, Object.keys(metadata.menus).length - manifest.classifiedMenuCount);
  manifest.generatedAt = new Date().toISOString();
  await writeJsonAtomic(manifestPath, manifest);
  console.log(`Completed ${completed}/${selected.length} menu classifications; ${modelFailures.length} failed. Model: ${CODEX_MODEL}, reasoning effort: ${REASONING_EFFORT}.`);
  if (modelFailures.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
