#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
import { access, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { DiningCityApiClient } from '../src/client.js';
import { hashMenuForScoring } from './menu-hash.mjs';
import { PROMPT_VERSION } from './menu-scoring-version.mjs';

const API_KEY = 'cgecegcegcc';
const CITY = 'singapore';
const PER_PAGE = 8;
const MENU_CONCURRENCY = 4;
const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'public', 'data');

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`Could not read existing generated data ${path}: ${error.message}`);
  }
}

async function publishDirectory(stagedDir, liveDir) {
  await mkdir(liveDir, { recursive: true });
  const stagedEntries = await readdir(stagedDir, { withFileTypes: true });
  const expected = new Set(stagedEntries.map((entry) => entry.name));
  let changed = false;

  for (const entry of stagedEntries) {
    const stagedPath = join(stagedDir, entry.name);
    const livePath = join(liveDir, entry.name);
    if (entry.isDirectory()) {
      changed = (await publishDirectory(stagedPath, livePath)) || changed;
    } else if (entry.isFile()) {
      try {
        const [stagedContents, liveContents] = await Promise.all([readFile(stagedPath), readFile(livePath)]);
        if (stagedContents.equals(liveContents)) continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }

      const temporaryPath = `${livePath}.${randomUUID()}.tmp`;
      await copyFile(stagedPath, temporaryPath);
      try {
        await rename(temporaryPath, livePath);
        changed = true;
      } catch (error) {
        await rm(temporaryPath, { force: true });
        throw error;
      }
    }
  }

  for (const entry of await readdir(liveDir, { withFileTypes: true })) {
    if (!expected.has(entry.name)) {
      await rm(join(liveDir, entry.name), { recursive: true, force: true });
      changed = true;
    }
  }
  return changed;
}

function restaurantKey(id) {
  const key = String(id);
  if (!/^[A-Za-z0-9_-]+$/.test(key)) throw new TypeError(`Unsafe restaurant ID: ${key}`);
  return key;
}

async function fetchRestaurants(client) {
  const restaurants = [];
  const seenIds = new Set();

  for (let page = 1; ; page += 1) {
    const result = await client.getRestaurants({ page, per_page: PER_PAGE });
    if (!Array.isArray(result.items)) throw new TypeError(`Restaurant page ${page} was not an array`);

    for (const restaurant of result.items) {
      if (restaurant?.id == null || String(restaurant.id).trim() === '') {
        throw new TypeError(`Restaurant page ${page} contains a record without an ID`);
      }
      const key = restaurantKey(restaurant.id);
      if (seenIds.has(key)) throw new Error(`Restaurant API returned duplicate ID ${key}`);
      seenIds.add(key);
      restaurants.push(restaurant);
    }

    console.log(`Restaurants page ${page}: ${result.length} records`);
    if (result.length === 0 || result.length < PER_PAGE) break;
  }

  if (restaurants.length === 0) throw new Error('Restaurant API returned an empty snapshot; refusing to prune generated data');
  return restaurants;
}

async function fetchMenus(client, restaurants) {
  const menuRecords = new Array(restaurants.length);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= restaurants.length) return;

      const restaurant = restaurants[index];
      const key = restaurantKey(restaurant.id);
      const menu = await client.getMenu(restaurant.id);
      if (!Array.isArray(menu.meals) || menu.length === 0) {
        throw new Error(`No menu found for ${restaurant.name} (${key}); refusing to publish a partial snapshot`);
      }
      if (String(menu.restaurantId) !== key) {
        throw new Error(`Menu response for ${key} was associated with restaurant ${menu.restaurantId}`);
      }

      const hash = hashMenuForScoring(menu.meals);
      menuRecords[index] = { restaurant, meals: menu.meals, key, ...hash };
      console.log(`Menu ${index + 1}/${restaurants.length}: ${restaurant.name} (${key})`);
    }
  }

  await Promise.all(Array.from({ length: Math.min(MENU_CONCURRENCY, restaurants.length) }, worker));
  return menuRecords;
}

function compareSnapshot(restaurants, menuRecords, previousMetadata) {
  const incoming = new Set(menuRecords.map(({ key }) => key));
  const previous = new Set(Object.keys(previousMetadata.menus ?? {}));
  const added = [];
  const changed = [];
  const unchanged = [];

  for (const record of menuRecords) {
    const old = previousMetadata.menus?.[record.key];
    if (!old) added.push(record.key);
    else if (old.menuHash !== record.menuHash || old.hashVersion !== record.hashVersion) changed.push(record.key);
    else unchanged.push(record.key);
  }

  return {
    added,
    changed,
    unchanged,
    removed: [...previous].filter((key) => !incoming.has(key)),
    restaurantCount: restaurants.length,
  };
}

async function writeSnapshot(restaurants, menuRecords, report, previousScores, previousScoresDir) {
  const scoringRubric = await readJson(join(root, 'config', 'menu-scoring-rubric.json'), null);
  if (!scoringRubric?.version) throw new Error('The current menu scoring rubric is missing or invalid.');
  const stagingDir = join(tmpdir(), `restaurant-week-data-stage-${process.pid}-${randomUUID()}`);
  const stageRestaurantsDir = join(stagingDir, 'restaurants');
  const stageMenusDir = join(stagingDir, 'menus');
  const stageScoresDir = join(stagingDir, 'scores');
  const menuIndex = {};
  const metadata = {
    schemaVersion: 1,
    hashAlgorithm: menuRecords[0].hashAlgorithm,
    hashVersion: menuRecords[0].hashVersion,
    menus: {},
  };
  const nextScores = { schemaVersion: 1, byRestaurantId: {} };

  try {
    await Promise.all([
      mkdir(stageRestaurantsDir, { recursive: true }),
      mkdir(stageMenusDir, { recursive: true }),
      mkdir(stageScoresDir, { recursive: true }),
    ]);

    await writeFile(join(stageRestaurantsDir, 'restaurants.json'), json(restaurants));

    for (const record of menuRecords) {
      const filename = `${record.key}.json`;
      const analysisRecord = previousScores.byRestaurantId?.[record.key];
      const resultFile = analysisRecord?.classificationFile;
      const keepsAnalysis = analysisRecord?.menuHash === record.menuHash
        && typeof resultFile === 'string'
        && !resultFile.includes('..')
        && !resultFile.includes('/')
        && !resultFile.includes('\\');

      menuIndex[record.key] = filename;
      metadata.menus[record.key] = {
        restaurantId: record.restaurant.id,
        file: filename,
        menuHash: record.menuHash,
        hashAlgorithm: record.hashAlgorithm,
        hashVersion: record.hashVersion,
        analysisStatus: keepsAnalysis
          && analysisRecord.rubricVersion === scoringRubric.version
          && analysisRecord.promptVersion === PROMPT_VERSION
          ? 'classified'
          : 'pending',
        rubricVersion: keepsAnalysis ? analysisRecord.rubricVersion : null,
        promptVersion: keepsAnalysis ? analysisRecord.promptVersion : null,
        classificationFile: keepsAnalysis ? analysisRecord.classificationFile ?? null : null,
      };

      await writeFile(join(stageMenusDir, filename), json({ restaurant_id: record.restaurant.id, meals: record.meals }));

      if (keepsAnalysis) {
        const oldScorePath = join(previousScoresDir, resultFile);
        try {
          await access(oldScorePath);
          await copyFile(oldScorePath, join(stageScoresDir, resultFile));
          nextScores.byRestaurantId[record.key] = analysisRecord;
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          metadata.menus[record.key].analysisStatus = 'pending';
          metadata.menus[record.key].rubricVersion = null;
          metadata.menus[record.key].classificationFile = null;
        }
      }
    }

    await Promise.all([
      writeFile(join(stageMenusDir, 'index.json'), json(menuIndex)),
      writeFile(join(stageMenusDir, 'metadata.json'), json(metadata)),
      writeFile(join(stageScoresDir, 'index.json'), json(nextScores)),
    ]);

    // Data is staged outside the served tree. Once every API response and
    // generated file is valid, sync into stable paths and remove obsolete IDs.
    let dataChanged = false;
    for (const name of ['restaurants', 'menus', 'scores']) {
      dataChanged = (await publishDirectory(join(stagingDir, name), join(dataDir, name))) || dataChanged;
    }
    const previousManifest = await readJson(join(dataDir, 'manifest.json'), {});
    const classifiedMenuCount = Object.values(nextScores.byRestaurantId).filter((entry) => (
      entry.rubricVersion === scoringRubric.version && entry.promptVersion === PROMPT_VERSION
    )).length;
    const manifest = {
      event: 'rwsg_autumn_2026',
      city: CITY,
      restaurantCount: restaurants.length,
      menuCount: menuRecords.length,
      rubricVersion: scoringRubric.version,
      promptVersion: PROMPT_VERSION,
      classifiedMenuCount,
      needsClassificationCount: menuRecords.length - classifiedMenuCount,
      generatedAt: dataChanged || !previousManifest.generatedAt ? new Date().toISOString() : previousManifest.generatedAt,
    };
    const stagedManifestPath = join(stagingDir, 'manifest.json');
    await writeFile(stagedManifestPath, json(manifest));
    const manifestTempPath = join(dataDir, `.manifest-${randomUUID()}.tmp`);
    await copyFile(stagedManifestPath, manifestTempPath);
    try {
      await rename(manifestTempPath, join(dataDir, 'manifest.json'));
    } catch (error) {
      await rm(manifestTempPath, { force: true });
      throw error;
    }

  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }

  await rm(stagingDir, { recursive: true, force: true });

  console.log(`Published ${report.restaurantCount} restaurants: ${report.added.length} added, ${report.changed.length} menu-changed, ${report.unchanged.length} unchanged, ${report.removed.length} removed.`);
}

async function main() {
  for (const arg of args) {
    if (arg !== '--dry-run') throw new Error(`Unknown option: ${arg}`);
  }

  const client = new DiningCityApiClient({ apiKey: API_KEY, city: CITY });
  const restaurants = await fetchRestaurants(client);
  const menuRecords = await fetchMenus(client, restaurants);
  const previousMetadata = await readJson(join(dataDir, 'menus', 'metadata.json'), { menus: {} });
  const previousScoresDir = join(dataDir, 'scores');
  const previousScores = await readJson(join(previousScoresDir, 'index.json'), { schemaVersion: 1, byRestaurantId: {} });
  const report = compareSnapshot(restaurants, menuRecords, previousMetadata);

  console.log(`Snapshot: ${report.added.length} added, ${report.changed.length} menu-changed, ${report.unchanged.length} unchanged, ${report.removed.length} removed.`);
  if (report.added.length) console.log(`Added IDs: ${report.added.join(', ')}`);
  if (report.changed.length) console.log(`Menu-changed IDs: ${report.changed.join(', ')}`);
  if (report.removed.length) console.log(`Removed IDs: ${report.removed.join(', ')}`);

  if (dryRun) {
    console.log('Dry run: generated data was not changed.');
    return;
  }

  await writeSnapshot(restaurants, menuRecords, report, previousScores, previousScoresDir);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
