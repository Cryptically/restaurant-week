#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'public', 'data');
const rubricPath = join(root, 'config', 'menu-scoring-rubric.v1.json');
const RESULT_SCHEMA_VERSION = 'menu-item-classification-v1';
const PROMPT_VERSION = 'menu-item-classifier-v2';
const CODEX_MODEL = 'gpt-6-luna';
const REASONING_EFFORT = 'high';
const DEFAULT_CONCURRENCY = 10;
const MAX_ATTEMPTS = 3;
const CODEX_TIMEOUT_MS = 5 * 60 * 1000;
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
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) {
    throw new Error('CODEX_SCORE_CONCURRENCY must be an integer from 1 to 10');
  }
}

function buildClassificationInput(restaurantId, menuHash, rubric, menu) {
  return {
    restaurantId,
    menuHash,
    rubricVersion: rubric.version,
    criteria: rubric.criteria.map(({ id, label, description }) => ({ id, label, description })),
    meals: menu.meals.map((meal, mealIndex) => ({
      mealIndex,
      mealType: String(meal.meal_type ?? ''),
      title: String(meal.menu_title ?? ''),
      sections: (meal.extras_menu?.course_groups ?? []).map((section, sectionIndex) => ({
        sectionIndex,
        name: String(section.name ?? ''),
        items: (section.subs ?? []).map((item, itemIndex) => ({
          itemIndex,
          sourceItemId: String(item.id ?? item.source_id ?? `${mealIndex}-${sectionIndex}-${itemIndex}`),
          name: String(item.name ?? ''),
          description: String(item.desc ?? ''),
          tags: Array.isArray(item.tags) ? item.tags.map(String) : [],
        })),
      })),
    })),
  };
}

function buildPrompt(input) {
  return [
    'Classify food categories for each individual menu item. Return one JSON object matching the output schema.',
    'Use only the supplied item name, description, and tags. Do not infer ingredients from cuisine or likely recipes.',
    'Classify every item independently for every criterion. An item may match several criteria.',
    'Use present only when supported by the supplied text. Use uncertain when the wording is insufficient. Use absent only when the available item text clearly rules out that criterion.',
    'For present, evidence must be an exact substring of that same item name, description, or tag. For absent and uncertain, evidence must be null.',
    'Ikura and other fish roe count as fish, never shellfish. Shellfish means crustaceans or molluscs only. Fish and fish roe are separate from shellfish.',
    'Vegetarian means the menu explicitly marks the item vegetarian or its listed ingredients clearly support a complete vegetarian dish. A side, sauce, or garnish alone is insufficient.',
    'Preserve every meal, section, and item exactly once and in source order. Copy every index, section name, and source item ID exactly. Do not return any scores or aggregates.',
    'Menu input as JSON:',
    JSON.stringify(input),
  ].join('\n\n');
}

function buildOutputSchema(input) {
  const criteriaIds = input.criteria.map((criterion) => criterion.id);
  const findingSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['status', 'evidence'],
    properties: {
      status: { type: 'string', enum: ['present', 'absent', 'uncertain'] },
      evidence: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    },
  };
  const itemSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['itemIndex', 'sourceItemId', 'classifications'],
    properties: {
      itemIndex: { type: 'integer' },
      sourceItemId: { type: 'string' },
      classifications: {
        type: 'object',
        additionalProperties: false,
        required: criteriaIds,
        properties: Object.fromEntries(criteriaIds.map((id) => [id, findingSchema])),
      },
    },
  };
  const sectionSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['sectionIndex', 'name', 'items'],
    properties: {
      sectionIndex: { type: 'integer' },
      name: { type: 'string' },
      items: { type: 'array', items: itemSchema },
    },
  };
  const mealSchema = {
    type: 'object',
    additionalProperties: false,
    required: ['mealIndex', 'mealType', 'sections'],
    properties: {
      mealIndex: { type: 'integer' },
      mealType: { type: 'string' },
      sections: { type: 'array', items: sectionSchema },
    },
  };

  return {
    type: 'object',
    additionalProperties: false,
    required: ['restaurantId', 'menuHash', 'rubricVersion', 'meals'],
    properties: {
      restaurantId: { type: 'string' },
      menuHash: { type: 'string' },
      rubricVersion: { type: 'string' },
      meals: { type: 'array', items: mealSchema },
    },
  };
}

function validateClassification(output, input) {
  if (output?.restaurantId !== input.restaurantId || output?.menuHash !== input.menuHash || output?.rubricVersion !== input.rubricVersion) {
    throw new TypeError('LLM output restaurant ID, menu hash, or rubric version did not match the input');
  }
  if (!Array.isArray(output.meals) || output.meals.length !== input.meals.length) {
    throw new TypeError(`Expected ${input.meals.length} classified meals`);
  }

  const expectedCriteria = input.criteria.map(({ id }) => id).sort();
  for (const [mealPosition, sourceMeal] of input.meals.entries()) {
    const resultMeal = output.meals[mealPosition];
    if (resultMeal?.mealIndex !== sourceMeal.mealIndex || resultMeal.mealType !== sourceMeal.mealType) {
      throw new TypeError(`Meal ${sourceMeal.mealIndex} identity did not match the menu`);
    }
    if (!Array.isArray(resultMeal.sections) || resultMeal.sections.length !== sourceMeal.sections.length) {
      throw new TypeError(`Expected ${sourceMeal.sections.length} sections for meal ${sourceMeal.mealIndex}`);
    }

    for (const [sectionPosition, sourceSection] of sourceMeal.sections.entries()) {
      const resultSection = resultMeal.sections[sectionPosition];
      if (resultSection?.sectionIndex !== sourceSection.sectionIndex || resultSection.name !== sourceSection.name) {
        throw new TypeError(`Section ${sourceMeal.mealIndex}/${sourceSection.sectionIndex} identity did not match the menu`);
      }
      if (!Array.isArray(resultSection.items) || resultSection.items.length !== sourceSection.items.length) {
        throw new TypeError(`Expected ${sourceSection.items.length} items for section ${sourceMeal.mealIndex}/${sourceSection.sectionIndex}`);
      }

      for (const [itemPosition, sourceItem] of sourceSection.items.entries()) {
        const resultItem = resultSection.items[itemPosition];
        if (resultItem?.itemIndex !== sourceItem.itemIndex || resultItem.sourceItemId !== sourceItem.sourceItemId) {
          throw new TypeError(`Item ${sourceMeal.mealIndex}/${sourceSection.sectionIndex}/${sourceItem.itemIndex} identity did not match the menu`);
        }
        const classifications = resultItem.classifications;
        const receivedCriteria = Object.keys(classifications ?? {}).sort();
        if (JSON.stringify(receivedCriteria) !== JSON.stringify(expectedCriteria)) {
          throw new TypeError(`Item ${sourceMeal.mealIndex}/${sourceSection.sectionIndex}/${sourceItem.itemIndex} has an invalid criterion set`);
        }

        const sourceText = [sourceItem.name, sourceItem.description, ...sourceItem.tags].filter(Boolean).join('\n').toLocaleLowerCase();
        for (const criterionId of expectedCriteria) {
          const finding = classifications[criterionId];
          if (!['present', 'absent', 'uncertain'].includes(finding?.status)) {
            throw new TypeError(`Invalid status for ${criterionId} on item ${sourceMeal.mealIndex}/${sourceSection.sectionIndex}/${sourceItem.itemIndex}`);
          }
          const evidence = finding.evidence == null ? null : String(finding.evidence).trim();
          if (finding.status === 'present' && (!evidence || !sourceText.includes(evidence.toLocaleLowerCase()))) {
            throw new TypeError(`Evidence for ${criterionId} is missing or not quoted from that menu item`);
          }
          if (finding.status !== 'present' && evidence !== null) {
            throw new TypeError(`Only present classifications may include evidence (${criterionId})`);
          }
        }
      }
    }
  }
  return output;
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

async function classifyInput(input) {
  const prompt = buildPrompt(input);
  const schema = buildOutputSchema(input);
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const rawOutput = await runCodex(prompt, schema);
      return validateClassification(rawOutput, input);
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        console.warn(`Codex attempt ${attempt}/${MAX_ATTEMPTS} failed for ${input.restaurantId}: ${error.message}`);
        await sleep(1000 * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError;
}

async function classifyMenu(input) {
  const itemCount = input.meals.reduce((mealTotal, meal) => (
    mealTotal + meal.sections.reduce((sectionTotal, section) => sectionTotal + section.items.length, 0)
  ), 0);
  const inputs = itemCount > 120
    ? input.meals.map((meal) => ({ ...input, meals: [meal] }))
    : [input];

  if (inputs.length > 1) {
    console.log(`Splitting ${input.restaurantId}'s ${itemCount} items into ${inputs.length} meal calls to keep each response manageable.`);
  }

  const meals = [];
  for (const part of inputs) {
    const classified = await classifyInput(part);
    meals.push(...classified.meals);
  }

  return { ...input, meals };
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
        const classified = await classifyMenu(input);
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
          metadata.menus[id].scoreFile = null;
          await writeJsonAtomic(scoreIndexPath, scoreIndex);
          await writeJsonAtomic(metadataPath, metadata);
        });
        await writeChain;
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
  manifest.classifiedMenuCount = Object.keys(scoreIndex.byRestaurantId).length;
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
