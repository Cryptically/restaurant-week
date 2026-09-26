# UI menu matching

The UI calculates matches locally from saved item classifications. Selecting foods does not call Codex. Selected foods are alternatives: fish + pork means **fish or pork**. The restaurant list loads one compact `scores/summary.json` containing a bitmask of present foods for each course. Opening a restaurant loads only that restaurant's full classification file for item-level evidence. The summary is generated from the saved classifications, not from a second model call.

## Calculation

1. **Item:** match when any selected criterion is `present` on the item; otherwise no match.
2. **Section/course:** match when any item in that section matches. `or` and `and` separators do not change this availability check: a matching choice can be selected with `or`, and a matching item is included with `and`.
3. **Menu variant:** count matching sections out of all sections and show that count plus `matching / total × 100%`. Every section counts for now, including dessert, bread, cheese, and drinks. A menu with three matching sections out of four shows `3/4 courses · 75%`.
4. **Restaurant overview:** use the menu variant with the highest percentage; break percentage ties by the number of matching sections. Selecting the first food filter automatically switches to `Match score: high to low`, which orders restaurants by that percentage, then by each restaurant's lowest listed meal price, then by matching-section count. A later manual sort choice is preserved while food filters change. Clearing all food filters returns to Featured if match sorting is still active.

Price low to high and high to low use each restaurant's lowest listed meal price across all of its menu variants, regardless of which variant scored best. Rating ties also use that lowest price. Prices come from `meals_with_price`; they are starting prices per person, not the cost of every item a diner might order.

Search, cuisine, meal type, location, tag, price level, selected foods, and sort order are stored in the page URL. Reloading or sharing the URL restores those filters. The selected restaurant and menu variant remain in the URL as well.

The item and section badges show `Match` or `No match`. Item details show the selected criteria and any saved evidence. If a needed classification or section has no items, the match is unavailable; missing data is not counted as a miss.

In the restaurant view, each menu tab shows its own match percentage. The selected menu's matching-course count and percentage appear beside its price; the menu heading shows only the number of menu options.

## Saved versions

The current index contains rubric v4/prompt v4 classifications for all 107 menus. The UI also accepts valid v3 classifications for compatibility. Legacy `uncertain` findings count as no match and appear as absent in the UI; v4 classifications contain only `present` and `absent`. A classification must match its restaurant ID, menu hash, and index metadata before it is displayed.

The denominator currently treats all sections equally. Dish type eligibility is not part of this calculation.
