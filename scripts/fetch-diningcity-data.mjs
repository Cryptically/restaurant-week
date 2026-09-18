#!/usr/bin/env node

import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DiningCityApiClient } from '../docs/js/client.js';

const API_KEY = 'cgecegcegcc';
const CITY = 'singapore';
const PER_PAGE = 8;

const root = fileURLToPath(new URL('..', import.meta.url));
const dataDir = join(root, 'docs', 'data');
const restaurantsDir = join(dataDir, 'restaurants');
const menusDir = join(dataDir, 'menus');

function fileSlug(restaurant) {
  const slug = String(restaurant.dirname ?? restaurant.name ?? restaurant.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${restaurant.id}-${slug || 'restaurant'}`;
}

async function fetchRestaurants(client) {
  const restaurants = [];
  const seenIds = new Set();

  for (let page = 1; ; page += 1) {
    const result = await client.getRestaurants({ page, per_page: PER_PAGE });
    const records = result.items;

    for (const restaurant of records) {
      if (restaurant?.id == null || seenIds.has(restaurant.id)) continue;
      seenIds.add(restaurant.id);
      restaurants.push(restaurant);
    }

    console.log(`Restaurants page ${page}: ${records.length} records`);
    if (result.length === 0 || result.length < PER_PAGE) break;
  }

  return restaurants;
}

async function main() {
  // This is the generated output directory only. Rebuild it from scratch.
  await rm(dataDir, { recursive: true, force: true });
  await Promise.all([
    mkdir(restaurantsDir, { recursive: true }),
    mkdir(menusDir, { recursive: true }),
  ]);

  const client = new DiningCityApiClient({ apiKey: API_KEY, city: CITY });
  const restaurants = await fetchRestaurants(client);

  const menuRecords = [];
  const missingMenus = [];
  for (const restaurant of restaurants) {
    const menu = await client.getMenu(restaurant.id);
    if (menu.length === 0) {
      missingMenus.push({ id: restaurant.id, name: restaurant.name });
      continue;
    }

    menuRecords.push({
      restaurant,
      meals: menu.meals,
    });
    console.log(`Menu ${menuRecords.length}/${restaurants.length}: ${restaurant.name} (${restaurant.id})`);
  }

  if (missingMenus.length > 0) {
    const details = missingMenus.map(({ id, name }) => `${name} (${id})`).join(', ');
    throw new Error(`No menu found for ${missingMenus.length} restaurant(s): ${details}`);
  }

  await writeFile(
    join(restaurantsDir, 'restaurants.json'),
    `${JSON.stringify(restaurants, null, 2)}\n`,
  );

  for (const { restaurant, meals } of menuRecords) {
    await writeFile(
      join(menusDir, `${fileSlug(restaurant)}.json`),
      `${JSON.stringify({ restaurant, meals }, null, 2)}\n`,
    );
  }

  await writeFile(
    join(dataDir, 'manifest.json'),
    `${JSON.stringify({
      event: 'rwsg_autumn_2026',
      city: CITY,
      restaurantCount: restaurants.length,
      menuCount: menuRecords.length,
      generatedAt: new Date().toISOString(),
    }, null, 2)}\n`,
  );

  console.log(`Saved ${restaurants.length} restaurants and ${menuRecords.length} menus under ${dataDir}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
