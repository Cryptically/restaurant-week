#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function buildScoreSummary() {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const dataDir = join(root, 'public', 'data');
  const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
  const rubric = await readJson(join(root, 'config', 'menu-scoring-rubric.json'));
  const index = await readJson(join(dataDir, 'scores', 'index.json'));
  const metadata = await readJson(join(dataDir, 'menus', 'metadata.json'));
  const criteria = rubric.criteria.map(({ id }) => id);
  const byRestaurantId = {};

  for (const [id, entry] of Object.entries(index.byRestaurantId)) {
    if (!/^[A-Za-z0-9_-]+\.json$/.test(entry.classificationFile)) {
      throw new Error(`Unsafe classification filename for restaurant ${id}`);
    }
    const classification = await readJson(join(dataDir, 'scores', entry.classificationFile));
    if (String(classification.restaurantId) !== id
      || classification.menuHash !== entry.menuHash
      || classification.menuHash !== metadata.menus[id]?.menuHash
      || classification.rubricVersion !== entry.rubricVersion
      || classification.promptVersion !== entry.promptVersion) {
      throw new Error(`Stale classification for restaurant ${id}`);
    }

    byRestaurantId[id] = {
      menuHash: entry.menuHash,
      rubricVersion: entry.rubricVersion,
      promptVersion: entry.promptVersion,
      meals: classification.meals.map((meal) => ({
        title: meal.title,
        mealType: meal.mealType,
        sections: meal.sections.map((section) => {
          if (!section.items.length) return null;
          let mask = 0;
          for (const item of section.items) {
            for (const [criterionIndex, criterion] of criteria.entries()) {
              const status = item.classifications?.[criterion]?.status;
              if (!['present', 'absent', 'uncertain'].includes(status)) {
                throw new Error(`Missing ${criterion} classification for restaurant ${id}`);
              }
              if (status === 'present') mask |= 1 << criterionIndex;
            }
          }
          return mask;
        }),
      })),
    };
  }

  const output = `${JSON.stringify({ schemaVersion: 1, criteria, byRestaurantId })}\n`;
  const path = join(dataDir, 'scores', 'summary.json');
  let previous = null;
  try {
    previous = await readFile(path, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (output !== previous) await writeFile(path, output);
  console.log(`Built menu match summary for ${Object.keys(byRestaurantId).length} restaurants.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildScoreSummary();
}
