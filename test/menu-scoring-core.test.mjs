import test from 'node:test';
import assert from 'node:assert/strict';
import rubric from '../config/menu-scoring-rubric.json' with { type: 'json' };
import { calculateItemScore, calculateSectionScore, meanScore } from '../scripts/menu-scoring-core.mjs';
import { buildClassificationInput } from '../scripts/menu-scoring-input.mjs';

test('v4 rubric recognizes catch of the day as fish and keeps the short Lamb label', () => {
  assert.equal(rubric.version, 'menu-food-variety-v4');
  assert.match(rubric.criteria.find(({ id }) => id === 'fish').description, /catch of the day/i);
  assert.equal(rubric.criteria.find(({ id }) => id === 'lamb_goat').label, 'Lamb');
});

test('classification input keeps name, full description, and tags together on one item', () => {
  const input = buildClassificationInput(42, 'menu-hash', rubric, {
    meals: [{
      meal_type: 'dinner',
      menu_title: 'Dinner Set',
      extras_menu: {
        course_groups: [{
          name: 'Main',
          subs: [{ id: 10, name: 'Catch of the day', desc: 'Served with local vegetables', tags: [{ name: 'chef pick' }, { name: 'Supplement of $5++' }] }],
        }],
      },
    }],
  });

  assert.deepEqual(input.meals[0].sections[0].items[0], {
    itemIndex: 0,
    sourceItemId: '10',
    name: 'Catch of the day',
    description: 'Served with local vegetables',
    tags: ['chef pick'],
  });
});

test('item match needs any selected criterion explicitly listed', () => {
  const criteria = rubric.criteria;
  const findings = {
    fish: { status: 'present' },
    shellfish: { status: 'absent' },
    beef: { status: 'present' },
    pork: { status: 'absent' },
    poultry: { status: 'absent' },
    lamb_goat: { status: 'absent' },
    vegetarian: { status: 'absent' },
  };

  assert.equal(calculateItemScore(criteria, findings), 100);
  assert.equal(calculateItemScore(criteria, Object.fromEntries(criteria.map(({ id }) => [id, { status: 'present' }]))), 100);
  const porkAndShellfish = [{ id: 'pork' }, { id: 'shellfish' }];
  assert.equal(calculateItemScore(porkAndShellfish, {
    pork: { status: 'absent' },
    shellfish: { status: 'present' },
  }), 100);
  assert.equal(calculateItemScore(porkAndShellfish, {
    pork: { status: 'absent' },
    shellfish: { status: 'absent' },
  }), 0);
});

test('course match needs any selected criterion in any course choice', () => {
  const criteria = [{ id: 'pork' }, { id: 'shellfish' }];
  const choices = [
    { classifications: { pork: { status: 'present' }, shellfish: { status: 'absent' } } },
    { classifications: { pork: { status: 'absent' }, shellfish: { status: 'present' } } },
  ];

  assert.equal(calculateSectionScore(criteria, choices), 100);
  assert.equal(calculateSectionScore(criteria, [choices[1]]), 100);
});

test('unknown course scores are omitted from meal and overall means', () => {
  assert.equal(meanScore([50, 75, null]), 62.5);
  assert.equal(meanScore([null, null]), null);
});
