import test from 'node:test';
import assert from 'node:assert/strict';
import { DiningCityApiClient } from '../docs/js/client.js';

const API_KEY = 'cgecegcegcc';
const BASE_URL = 'https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026';
const client = new DiningCityApiClient({ apiKey: API_KEY });

async function rawJson(path, query) {
  const url = new URL(`${BASE_URL}/${path}`);
  url.search = new URLSearchParams({ 'api-key': API_KEY, ...query });
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  assert.equal(response.ok, true, `Raw API request failed: ${response.status}`);
  return response.json();
}

function compareJson(label, clientResult, rawResult) {
  const clientJson = JSON.stringify(clientResult);
  const rawJsonText = JSON.stringify(rawResult);
  assert.deepEqual(JSON.parse(clientJson), JSON.parse(rawJsonText), `${label} is not 1:1`);
}

test('restaurant page 1 serializes 1:1 with the raw API response', async () => {
  const [clientResult, rawResult] = await Promise.all([
    client.getRestaurants({ page: 1, per_page: 8, order_by: 'featured' }),
    rawJson('cities/singapore/restaurants', {
      per_page: '8', page: '1', order_by: 'featured',
    }),
  ]);

  compareJson('restaurant page 1', clientResult, rawResult);
});

test('five restaurant menus serialize 1:1 with their raw API responses', async () => {
  const restaurantIds = [2055216, 205191138, 205188876, 2055205, 2055219];

  for (const restaurantId of restaurantIds) {
    const [clientResult, rawResult] = await Promise.all([
      client.getMenu(restaurantId),
      rawJson(`restaurants/${restaurantId}/meals`, {
        platform: 'web', include_extras_menu: 'true', lang: 'en',
      }),
    ]);

    compareJson(`menu ${restaurantId}`, clientResult, rawResult);
  }
});
