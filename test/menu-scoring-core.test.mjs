import test from 'node:test';
import assert from 'node:assert/strict';
import rubric from '../config/menu-scoring-rubric.v1.json' with { type: 'json' };
import { calculateCourseScore, meanScore } from '../scripts/menu-scoring-core.mjs';

test('course score is the weighted share of explicitly present criteria', () => {
  const criteria = rubric.criteria;
  const findings = {
    fish: { status: 'present' },
    shellfish: { status: 'absent' },
    beef: { status: 'present' },
    pork: { status: 'uncertain' },
    poultry: { status: 'absent' },
    lamb_goat: { status: 'absent' },
    vegetarian: { status: 'absent' },
  };

  assert.equal(calculateCourseScore(criteria, findings), 34.3);
  assert.equal(calculateCourseScore(criteria, Object.fromEntries(criteria.map(({ id }) => [id, { status: 'present' }]))), 100);
});

test('unknown course scores are omitted from meal and overall means', () => {
  assert.equal(meanScore([50, 75, null]), 62.5);
  assert.equal(meanScore([null, null]), null);
});
