import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROMPT_VERSION } from './menu-scoring-version.mjs';

const dataDirectory = resolve(process.argv[2] || 'public/data');
const rubric = JSON.parse(readFileSync(fileURLToPath(new URL('../config/menu-scoring-rubric.json', import.meta.url)), 'utf8'));

function readJson(relativePath) {
  const filePath = join(dataDirectory, relativePath);
  assert.ok(existsSync(filePath), `Missing published data file: ${relativePath}`);
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

const restaurants = readJson('restaurants/restaurants.json');
const menuIndex = readJson('menus/index.json');
const menuMetadata = readJson('menus/metadata.json');
const scoreIndex = readJson('scores/index.json');
const manifest = readJson('manifest.json');

assert.ok(Array.isArray(restaurants), 'Restaurant data must be a JSON array.');
assert.ok(menuIndex && typeof menuIndex === 'object', 'Menu index must be an object.');
assert.ok(menuMetadata?.menus && typeof menuMetadata.menus === 'object', 'Menu metadata must include a menus object.');
assert.ok(scoreIndex?.byRestaurantId && typeof scoreIndex.byRestaurantId === 'object', 'Score index must include byRestaurantId.');
assert.ok(!('scoredMenuCount' in manifest) && !('needsScoringCount' in manifest), 'Manifest contains obsolete aggregate-score counts.');
assert.equal(manifest.restaurantCount, restaurants.length, 'Manifest restaurant count does not match the data.');
assert.equal(manifest.menuCount, restaurants.length, 'Manifest menu count does not match the data.');

const restaurantIds = new Set();
let currentClassificationCount = 0;
for (const restaurant of restaurants) {
  const id = String(restaurant?.id ?? '');
  assert.ok(id, 'Every restaurant must have an ID.');
  assert.ok(!restaurantIds.has(id), `Duplicate restaurant ID: ${id}`);
  restaurantIds.add(id);

  const menuFile = menuIndex[id];
  assert.ok(typeof menuFile === 'string' && basename(menuFile) === menuFile, `Missing or unsafe menu file mapping for restaurant ${id}.`);
  const menu = readJson(`menus/${menuFile}`);
  assert.equal(String(menu.restaurant_id), id, `Menu ${menuFile} does not belong to restaurant ${id}.`);

  const metadata = menuMetadata.menus[id];
  assert.ok(metadata, `Missing menu metadata for restaurant ${id}.`);
  assert.equal(metadata.file, menuFile, `Menu metadata file mismatch for restaurant ${id}.`);

  const scoreEntry = scoreIndex.byRestaurantId[id];
  const hasCurrentClassification = scoreEntry?.rubricVersion === rubric.version
    && scoreEntry?.promptVersion === PROMPT_VERSION;
  assert.equal(metadata.analysisStatus, hasCurrentClassification ? 'classified' : 'pending', `Menu analysis status is wrong for restaurant ${id}.`);
  if (hasCurrentClassification) currentClassificationCount += 1;
}

for (const [id, entry] of Object.entries(scoreIndex.byRestaurantId)) {
  assert.ok(restaurantIds.has(id), `Orphaned score index entry for restaurant ${id}.`);
  assert.equal(String(entry.restaurantId), id, `Score index ID mismatch for restaurant ${id}.`);
  assert.ok(typeof entry.classificationFile === 'string' && basename(entry.classificationFile) === entry.classificationFile, `Missing or unsafe classification file mapping for restaurant ${id}.`);

  const classification = readJson(`scores/${entry.classificationFile}`);
  assert.equal(String(classification.restaurantId), id, `Classification ID mismatch for restaurant ${id}.`);
  assert.equal(classification.menuHash, entry.menuHash, `Classification hash mismatch for restaurant ${id}.`);
  assert.equal(classification.menuHash, menuMetadata.menus[id]?.menuHash, `Classification is stale for restaurant ${id}.`);
  assert.equal(classification.rubricVersion, entry.rubricVersion, `Classification rubric version mismatch for restaurant ${id}.`);
  assert.equal(classification.promptVersion, entry.promptVersion, `Classification prompt version mismatch for restaurant ${id}.`);
}

assert.equal(manifest.rubricVersion, rubric.version, 'Manifest rubric version is not current.');
assert.equal(manifest.promptVersion, PROMPT_VERSION, 'Manifest prompt version is not current.');
assert.equal(manifest.classifiedMenuCount, currentClassificationCount, 'Manifest current classification count does not match the score index.');
assert.equal(manifest.needsClassificationCount, restaurants.length - currentClassificationCount, 'Manifest pending classification count does not match the score index.');

console.log(`Published data is consistent: ${restaurants.length} restaurants, ${currentClassificationCount} current classifications, ${restaurants.length - currentClassificationCount} pending.`);
