import test from 'node:test';
import assert from 'node:assert/strict';
import { RestaurantMenuViewModel, RestaurantViewModel } from '../src/view-models.js';

test('restaurant view model exposes reusable directory and detail values', () => {
  const restaurant = new RestaurantViewModel({
    id: 1,
    name: 'The Test Table',
    address: '',
    region_name: 'River Valley',
    cover: 'cover.jpg',
    thumb: 'thumb.jpg',
    ratings_avg: 4.5,
    format_avg_price: 'S$80',
    cuisines: [{ name: 'Modern European' }],
    locations: [{ name: 'Central' }],
    meals_with_price: [
      { meal_type: 'dinner', price: '68' },
      { meal_type: 'lunch', price: '48' },
    ],
  });

  assert.equal(restaurant.imageUrl, 'cover.jpg');
  assert.equal(restaurant.addressLabel, 'Singapore');
  assert.equal(restaurant.cuisineLabel, 'Modern European');
  assert.equal(restaurant.locationLabel, 'Central');
  assert.equal(restaurant.lowestMealPrice, 'SG$48');
  assert.equal(restaurant.priceItems[0].label, 'Dinner');
  assert.equal(restaurant.initials, 'TT');
});

test('menu view model exposes presentation values for nested menu data', () => {
  const menu = new RestaurantMenuViewModel({
    restaurantId: 1,
    meals: [{
      id: 2,
      meal_type: 'dinner',
      price: '88',
      menu_title: 'Dinner menu',
      minimum_seats_humanize: 'Minimum 2 guests',
      extras_menu: {
        desc: 'Includes service.',
        vat_text: 'GST included',
        course_groups: [{
          name: 'Starter',
          subs: [
            { name: 'First course', desc: 'Seasonal produce', tags: [] },
            { name: 'Second course', separator: 'or', price: '12.0', currency: 'S$', tags: [] },
          ],
        }],
      },
    }],
  });

  const meal = menu.meals[0];
  assert.equal(menu.length, 1);
  assert.equal(meal.tabLabel, 'Dinner');
  assert.equal(meal.title, 'Dinner menu');
  assert.equal(meal.priceLabel, 'SG$88');
  assert.deepEqual(meal.bookingDetails, ['Minimum 2 guests']);
  assert.equal(meal.extrasDescription, 'Includes service.');
  assert.equal(meal.courseGroups[0].items[1].showSeparator, true);
  assert.equal(meal.courseGroups[0].items[1].priceLabel, 'S$12.0');
  assert.equal(meal.notice, 'GST included');
});
