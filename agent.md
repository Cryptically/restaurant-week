# Restaurant Week Singapore

Mobile-first Restaurant Week directory for Singapore Autumn 2026. GitHub Pages publishes the generated `dist/` artifact through GitHub Actions.

## Architecture

The application uses Vite, Vue, and TypeScript-compatible source files. There is no backend. DiningCity data is fetched ahead of time and bundled as static JSON.

- `src/` contains editable application source.
- `public/data/` contains generated source data.
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
├── plan.md
└── agent.md
```

The root `data/` directory is an older export from the initial implementation and is not used by the app. The source-of-truth data is `public/data/`; the published copy is the temporary `dist/data/` build output.

## Source files

### `src/index.html`

Contains semantic markup and Vue directives only. Keep application logic and CSS out of this file. Vite processes it during the production build.

### `src/main.ts`

Bootstraps Vue, imports `styles.css`, loads restaurant/menu JSON, handles search and cuisine filtering, and manages the list/detail SPA state.

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

Uses `DiningCityApiClient` from `src/client.js` to fetch all restaurant pages and all menus. Every run:

1. Clears `public/data/`.
2. Fetches all restaurants.
3. Fetches every restaurant menu.
4. Fails if any restaurant has zero menu records.
5. Writes restaurants, menus, `menus/index.json`, and `manifest.json`.

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
node scripts/fetch-diningcity-data.mjs
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
