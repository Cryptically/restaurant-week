# Menu classifier

`npm run score:menus` classifies menu items ahead of time with Codex CLI. It saves food findings; it does not calculate the UI's item, course, or menu match.

## Input and rules

- Source menus come from `public/data/menus/`; `config/menu-scoring-rubric.json` defines the seven criteria in this order: fish, shellfish, beef, pork, poultry, lamb/goat, vegetarian.
- Each item is sent with its name, full description, and meaningful tag names. Supplement price tags are excluded. The model reads the name and description together as one item and must not infer ingredients from cuisine or likely recipes.
- Each criterion is binary. It is `present` only when that item's text supports it, and `absent` otherwise. New results never contain `uncertain`.
- A `present` finding requires an exact quote from that same item's name, description, or tag. `absent` has `null` evidence. Fish roe such as ikura is fish, not shellfish; the literal phrase “catch of the day” counts as fish.

## Model response and saved data

The runner sends at most 40 items per call. The model returns one compact row per item, in batch order. Each row contains the batch-local item index and only its positive findings:

```json
{"items":[[0,[[0,"salmon"],[3,"bacon"]]],[1,[]]]}
```

Criterion indexes follow the rubric order above. The example means item 0 has fish and pork; item 1 has no supported criteria. The runner checks every row index, criterion index, and evidence quote. If Codex repeats a positive criterion with valid evidence, the runner keeps its first quote. For a vegetarian item explicitly marked with `V` in parentheses or `[V]`, the runner can replace an invalid model quote with that exact source marker. It fills in all omitted criteria as `absent`, then rebuilds the original meal/section/item structure and stores the expanded classification at `public/data/scores/classification-<restaurant-id>.json`. The UI reads that expanded file, not the compact model response.

## Cache and running

The current classifier uses rubric v4, prompt v4, and saved schema v2 with `gpt-6-luna`. Reasoning effort defaults to `medium`; `CODEX_SCORE_REASONING_EFFORT` can select `low`, `medium`, or `high`. A result is skipped only when restaurant ID, menu hash, rubric, prompt, schema, model, reasoning effort, and the saved file match. Successful item batches are checkpointed locally in ignored `.cache/menu-scoring/` and reused if a menu run is interrupted. Checkpoints are removed after the completed menu is published.

The runner defaults to 8 concurrent Codex CLI processes; `CODEX_SCORE_CONCURRENCY` can set 1–25. Each batch has a five-minute timeout and up to three attempts. It requires Codex CLI sign-in. Failed menus receive records in `public/data/scores/failures/` and remain queued.

```powershell
npm run score:menus:dry-run
node scripts/score-menu-data.mjs --only=<restaurant-id>
npm run score:menus
```

Use the direct `node` command for `--only`. This npm version consumes `--only` as its own option, which would otherwise run the full menu queue.

The dry run makes no Codex calls or data changes. The v4 run is complete: all 107 menus and 2,902 items have current binary classifications, and a dry run queues zero menus. The UI still accepts valid v3 results for compatibility, but the current index points entirely to v4 results. Run the classifier again only when menus or classifier settings change; changing selected foods in the UI makes no model calls.
