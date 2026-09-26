function scoringTags(tags) {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((tag) => typeof tag === 'string' ? tag : tag?.name)
    .filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim())
    .filter((tag) => tag && !/^Supplement of\b/i.test(tag));
}

export function buildClassificationInput(restaurantId, menuHash, rubric, menu) {
  return {
    restaurantId,
    menuHash,
    rubricVersion: rubric.version,
    criteria: rubric.criteria.map(({ id, label, description }) => ({ id, label, description })),
    meals: menu.meals.map((meal, mealIndex) => ({
      mealIndex,
      mealType: String(meal.meal_type ?? ''),
      title: String(meal.menu_title ?? ''),
      sections: (meal.extras_menu?.course_groups ?? []).map((section, sectionIndex) => ({
        sectionIndex,
        name: String(section.name ?? ''),
        items: (section.subs ?? []).map((item, itemIndex) => ({
          itemIndex,
          sourceItemId: String(item.id ?? item.source_id ?? `${mealIndex}-${sectionIndex}-${itemIndex}`),
          name: String(item.name ?? ''),
          description: String(item.desc ?? ''),
          tags: scoringTags(item.tags),
        })),
      })),
    })),
  };
}
