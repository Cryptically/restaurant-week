import { createHash } from 'node:crypto';

export const MENU_HASH_VERSION = 'menu-score-input-v2';
export const MENU_HASH_ALGORITHM = 'sha256';

const text = (value) => value == null ? '' : String(value);
const tags = (items) => Array.isArray(items)
  ? items.map((tag) => text(tag?.name))
  : [];

/**
 * Project API menu data to fields that can affect course scoring. Keep array
 * order because the source uses order and "and"/"or" separators as meaning.
 * IDs, image URLs, counters, and prices are excluded to avoid rescoring for
 * changes that do not change the described food.
 */
export function normalizeMenuForScoring(meals) {
  if (!Array.isArray(meals)) throw new TypeError('Menu meals must be an array');

  return meals.map((meal) => ({
    meal_type: text(meal?.meal_type),
    menu_title: text(meal?.menu_title),
    desc: text(meal?.desc),
    extras_menu: meal?.extras_menu == null ? null : {
      desc: text(meal.extras_menu.desc),
      description: text(meal.extras_menu.description),
      course_groups: (Array.isArray(meal.extras_menu.course_groups) ? meal.extras_menu.course_groups : [])
        .map((group) => ({
          name: text(group?.name),
          optional_desc: text(group?.optional_desc),
          subs: (Array.isArray(group?.subs) ? group.subs : []).map((item) => ({
            name: text(item?.name),
            desc: text(item?.desc),
            separator: text(item?.separator),
            tags: tags(item?.tags),
          })),
        })),
    },
  }));
}

export function hashMenuForScoring(meals) {
  const normalized = normalizeMenuForScoring(meals);
  const digest = createHash(MENU_HASH_ALGORITHM)
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');

  return { menuHash: digest, hashAlgorithm: MENU_HASH_ALGORITHM, hashVersion: MENU_HASH_VERSION };
}
