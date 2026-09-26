# Restaurant Week Singapore

Mobile-first Restaurant Week directory for Singapore Autumn 2026. GitHub Pages publishes the generated `dist/` artifact through GitHub Actions.

## Architecture

The application uses Vite, Vue, and TypeScript-compatible source files. There is no backend. DiningCity data is fetched ahead of time and bundled as static JSON.

- `src/` contains editable application source.
- `public/data/` contains generated data at stable paths: `restaurants/`, `menus/`, `scores/`, and `manifest.json`. Fetch staging is temporary and outside the served data directory.
- `dist/` contains temporary Vite production output for GitHub Pages.
- Vue is installed through npm and bundled by Vite.
- Vite aliases Vue to `vue/dist/vue.esm-bundler.js` because the app uses the template in `src/index.html` and needs Vue's runtime compiler.
- Google Fonts remain a CDN dependency.
- The runtime page reads local JSON and does not call DiningCity directly.
- Restaurant selection and menu viewing are handled in one SPA view.

## Project structure

```text
restaurant-week/
├── src/
│   ├── index.html              # Vite entry template and Vue markup
│   ├── main.ts                 # Vue app and static-data loading
│   ├── client.js               # DiningCity models and API client
│   ├── styles.css              # Application styles
│   └── env.d.ts                # TypeScript declarations
├── public/
│   └── data/                   # Generated source JSON
│       ├── manifest.json
│       ├── restaurants/restaurants.json
│       └── menus/index.json + restaurant menu files
├── dist/                       # Temporary generated Pages artifact (gitignored)
│   ├── index.html
│   ├── assets/                 # Vite bundles
│   └── data/                   # Copied from public/data
├── scripts/
│   └── fetch-diningcity-data.mjs
├── test/
│   └── client.test.mjs
├── package.json
├── package-lock.json
├── vite.config.js
├── tsconfig.json
├── SCORING_CLASSIFIER.md
├── UI_SCORING.md
└── agent.md
```

The root `data/` directory is an older export from the initial implementation and is not used by the app. `public/data/` is the authoritative generated dataset; `dist/data/` is the build output copy. Restaurant records, ID-keyed menus, hashes, scores, and the manifest remain at stable paths between fetches.

## Source files

### `src/index.html`

Contains semantic markup and Vue directives only. Keep application logic and CSS out of this file. Vite processes it during the production build.

### `src/main.ts`

Bootstraps Vue, imports `styles.css`, loads restaurant/menu JSON from fixed `public/data/` paths, handles search and cuisine filtering, and displays a score only when its restaurant ID and menu hash match the current menu.

### `src/client.js`

Contains explicit 1:1 DiningCity model classes and the API client:

- `DiningCityApiClient`
- `Restaurant`, `RestaurantList`
- `RestaurantMenu`, `Meal`, `ExtrasMenu`
- `CourseGroup`, `MenuSubItem`, `MenuItem`, `MenuPhoto`
- `Tag`, `Cuisine`, `Location`, `MealPrice`

Missing model values use safe defaults. `toJSON()` preserves the API response shape so serialized client results can be compared with raw responses.

### `src/styles.css`

Contains all visual styling, responsive layout, typography, colors, focus states, loading states, error states, and mobile/desktop breakpoints.

### `scripts/fetch-diningcity-data.mjs`

Uses `DiningCityApiClient` from `src/client.js` to fetch and validate a complete restaurant/menu snapshot in temporary staging. It hashes scoring-relevant menu text, reports added/changed/unchanged/removed IDs, publishes to stable `public/data/` paths, then prunes stale records. `--dry-run` reports changes without writing. A failed or incomplete API fetch never changes published data.

Menus use stable ID filenames; names and slugs are display text only. `menus/metadata.json` stores SHA-256 `menuHash` and normalization version per restaurant. The index stays compatible with lazy menu loading. Scores are carried forward only for the same ID and matching menu hash.

### Menu scoring pipeline

See `SCORING_CLASSIFIER.md` for Codex classification, versions, caching, and run commands. See `UI_SCORING.md` for the selected-food match calculation. The scorer, data fetcher, and deploy validator import their prompt version from `scripts/menu-scoring-version.mjs`; update that shared constant and regenerated scoring data together when changing the classifier. Do not start a new Codex classification run unless the user asks.

Do not hand-edit `public/data/` or `dist/data/`; both are generated.

## Commands

Install dependencies:

```powershell
npm install
```

Run the local development server with fast hot reload:

```powershell
npm run dev
```

Vite normally serves the app at `http://localhost:5173/`. This is the preferred local workflow. Do not open the HTML through `file://`; browser fetches to local JSON are blocked by browser security rules.

Validate TypeScript:

```powershell
npm run typecheck
```

Run the live API/model comparison tests:

```powershell
npm test
```

Refresh the source data:

```powershell
npm run fetch:data -- --dry-run
npm run fetch:data
```

Preview the scoring queue without calling an LLM:

```powershell
npm run score:menus:dry-run
```

Build the production site into `dist/`:

```powershell
npm run build
```

The build clears and regenerates `dist/`, bundles/minifies the app, and copies `public/data/` into `dist/data/`.

Preview the production build:

```powershell
npm run preview
```

## Playwright visual checks

Use the Docker-backed Playwright MCP for browser QA. Vite runs on the Windows host and Playwright runs in the `playwright-mcp` Docker container. Start Vite normally:

```powershell
npm run dev
```

The Vite config binds to `0.0.0.0` and allows `host.docker.internal`, so from the Docker browser navigate to:

```text
http://host.docker.internal:5173/
```

Do not use `localhost` from the Playwright container: it points back to the container itself, not the Windows host. `localhost:5173` is still the right URL in a browser running directly on the host.

Codex's Playwright MCP config runs `/app/cli.js` inside the `playwright-mcp` container and selects the Chromium binary bundled with the image. This avoids fetching a newer MCP package with `npx @latest` or relying on a missing Chromium headless-shell binary. The MCP configuration is in the user's Codex config, not this repository. When updating or recreating the container, reconnect/restart the Playwright MCP if its tools report `Transport closed`.

The Docker Playwright workflow is:

1. Navigate to `http://host.docker.internal:5173/` with `browser_navigate`.
2. Take a page snapshot to inspect headings, controls, and accessible names.
3. Take a viewport screenshot at desktop size (`1280x720`).
4. Click a representative restaurant and inspect its menu.
5. Resize to mobile (`390x844`) and inspect the detail sheet, menu hierarchy, wrapping, and scroll behavior.
6. Use page evaluation only for read-only checks such as computed styles, dimensions, scroll state, and responsive state.
7. Stop the Vite process with `Ctrl+C` after the review.

If navigation fails, check in this order:

- Confirm Vite is running on port `5173` on the host.
- From inside `playwright-mcp`, check `http://host.docker.internal:5173/` (not `localhost`).
- A Vite `403` means `host.docker.internal` is missing from `server.allowedHosts` in `vite.config.js`.
- A connection refusal usually means Vite is bound only to loopback; keep `server.host` set to `0.0.0.0`.
- A Playwright MCP `Transport closed` error after container recreation means Codex needs to reconnect its MCP process.

Useful Playwright operations are `browser_navigate`, `browser_snapshot`, `browser_take_screenshot`, `browser_click`, `browser_resize`, and `browser_evaluate`. For UI changes, verify both the selected and empty states, plus at least one real menu with course groups and `and`/`or` separators.

On Windows, Vite can fail with `spawn EPERM` inside the sandbox. Retry the server or build with elevated process permission when that happens; do not change the application to work around the environment restriction.

The full refresh/build workflow is:

```powershell
node scripts/fetch-diningcity-data.mjs
npm run typecheck
npm test
npm run build
```

## Package scripts

```json
{
  "dev": "vite",
  "build": "vite build",
  "typecheck": "vue-tsc --noEmit",
  "test": "node --test test/client.test.mjs",
  "preview": "vite preview"
}
```

## Data and API

Event: `rwsg_autumn_2026`

City: `singapore`

Restaurant endpoint:

```text
https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026/cities/singapore/restaurants
```

Menu endpoint:

```text
https://api.diningcity.asia/public/extras_events/rwsg_autumn_2026/restaurants/<restaurant-id>/meals
```

The browser resolves menus through `public/data/menus/index.json` rather than guessing filenames.

Restaurant listing prices must use `meals_with_price`, not `prices[0]`. `prices` is only a summary list and does not represent every offer.

The API key is a public query parameter required by the source API. It is not a secret and must not be replaced with private credentials in this static repository.

## GitHub Pages

GitHub Pages is deployed by `.github/workflows/deploy.yml` using the Pages artifact workflow. Set `Settings → Pages → Source` to `GitHub Actions`.

The workflow installs dependencies, typechecks, runs tests, builds `dist/`, uploads it as a Pages artifact, and deploys it. `dist/` is temporary and is not committed.

Vite uses `base: './'`, and local asset/data paths are relative so the site works when hosted under a repository subpath.

Recommended deployment flow:

```powershell
node scripts/fetch-diningcity-data.mjs
npm run typecheck
npm test
npm run build
git add .github src public scripts test package.json package-lock.json vite.config.js tsconfig.json agent.md .gitignore
git commit -m "Refresh Restaurant Week site"
git push
```

## Maintenance rules

- Edit source files under `src/`, never generated files under `dist/`.
- Keep HTML markup in `src/index.html`.
- Keep Vue behavior in `src/main.ts`.
- Keep API models/request logic in `src/client.js`.
- Keep styles in `src/styles.css`.
- Keep generated source data in `public/data/` and regenerate it with the fetch script.
- Run `npm run typecheck`, `npm test`, and `npm run build` after structural changes.
- When adding an API property, map it explicitly and update the raw-response comparison tests.
- Preserve loading, empty, error, keyboard-focus, and mobile states.
