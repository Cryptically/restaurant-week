import test from 'node:test';
import assert from 'node:assert/strict';
import { hashMenuForScoring } from '../scripts/menu-hash.mjs';

const sampleMeal = () => [{
  id: 10,
  meal_type: 'dinner',
  menu_title: 'Dinner Set',
  price: '88',
  extras_menu: {
    course_groups: [{
      id: 20,
      name: 'Main Course',
      subs: [{ id: 30, name: 'Beef Short Rib', desc: 'Braised for 8 hours', separator: 'or', tags: [{ id: 4, name: 'Beef' }] }],
    }],
  },
}];

test('menu score hash is deterministic and ignores identity, price, and media metadata', () => {
  const a = sampleMeal();
  const b = sampleMeal();
  b[0].id = 999;
  b[0].price = '120';
  b[0].extras_menu.course_groups[0].id = 999;
  b[0].extras_menu.course_groups[0].subs[0].id = 999;
  b[0].extras_menu.course_groups[0].subs[0].tags[0].id = 999;

  assert.equal(hashMenuForScoring(a).menuHash, hashMenuForScoring(b).menuHash);
});

test('menu score hash changes when course or dish scoring text changes', () => {
  const baseline = hashMenuForScoring(sampleMeal()).menuHash;
  const changed = sampleMeal();
  changed[0].extras_menu.course_groups[0].subs[0].name = 'Pan-seared seabass';

  assert.notEqual(hashMenuForScoring(changed).menuHash, baseline);
});

test('menu score hash changes when grouping separators or relevant tags change', () => {
  const baseline = hashMenuForScoring(sampleMeal()).menuHash;
  const changedSeparator = sampleMeal();
  changedSeparator[0].extras_menu.course_groups[0].subs[0].separator = 'and';
  const changedTag = sampleMeal();
  changedTag[0].extras_menu.course_groups[0].subs[0].tags[0].name = 'Vegetarian';

  assert.notEqual(hashMenuForScoring(changedSeparator).menuHash, baseline);
  assert.notEqual(hashMenuForScoring(changedTag).menuHash, baseline);
});
