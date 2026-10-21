# Web Architecture

`web/` is a static Astro site (`output: 'static'`) that renders the CDL dataset catalog for different audiences, plus a county coverage map, static data previews, and a content-editing CMS. This document covers the site's structure, routing, content model, its relationship to the backend, and CI/CD. For the data-pipeline side, see [`backend/docs/PIPELINE.md`](../../../backend/docs/PIPELINE.md); for how the two projects fit together, see the repo-root [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Astro ^6, static output (SSG) |
| UI integration | `@astrojs/react`, React 19 (used selectively; most pages are plain Astro) |
| Styling | Tailwind CSS v4 via PostCSS (Flowbite was evaluated and explicitly removed — see `docs/technical/flowbite-evaluation.md`) |
| Language | TypeScript, `astro/tsconfigs/strict`, path aliases `@components/*`, `@layouts/*`, `@content/*`, `@lib/*`, `@data/*` |
| Content layer | Astro Content Collections — one collection, `master-library`, loaded via `glob()` from `src/content/master-library/**/*.md` |
| Local backend (dev) | Plain Node `http` server mirrored at `web/backend/`, run with `node --experimental-sqlite` |
| Map | Leaflet 1.9.4 (from unpkg) and `topojson-client` with one Census cartographic boundary TopoJSON file; `mapshaper` (dev) builds it |
| Data previews | Static Tier 1 files from the backend (`public/previews/`, copied at build) |
| CMS | Decap CMS, static admin at `public/admin/` |
| Hosting | Netlify (`netlify.toml`, functions, forms) and GitHub Pages (`.github/workflows/astro.yml`) |
| CI | GitHub Actions: `ci.yml` (lint/validate/build), `astro.yml` (Pages deploy) |

## `package.json` scripts

| Script | Runs |
|---|---|
| `dev` | `astro dev` (port 4321) |
| `backend:dev` | `node --experimental-sqlite backend/server.mjs` — local preview API, port 4323 |
| `sync:backend-yaml` | Copies canonical `../backend/data/sources` → `web/backend/data/sources` |
| `check:backend-yaml` | Sha256-diffs canonical vs. mirror; fails on drift |
| `sync:catalog` | Generates `src/content/master-library/datasets/*.md` from backend YAML |
| `backend:import` | Runs canonical backend's SQLite importer, copies `sources.db` into the mirror |
| `backend:pipeline` | Runs variable extraction for pipeline-ready sources, then `backend:import` |
| `check:geo` | Fails if any catalog coverage or community FIPS code is not in `src/data/geo-vocabulary.json` |
| `sync:previews` | Copies the backend's Tier 1 preview files into `public/previews/` (gitignored, incremental, 250 KB per file limit) |
| `prebuild` | `sync:backend-yaml && check:backend-yaml && sync:catalog && check:geo && sync:previews` (auto-runs before `build`) |
| `build` | `astro build` |
| `geo:boundaries` | Builds the TopoJSON boundary file and the county vocabulary from the Census files (manual; not in `prebuild`; `--from`, `--backend`) |
| `lint` | `eslint . --ext .ts,.tsx,.js,.jsx,.astro` |
| `check` | `lint && test && build` — full local gate |

## Directory overview

```
web/
├── backend/            local MIRROR of ../backend (do not edit directly — see ARCHITECTURE.md)
├── docs/               this documentation
├── netlify/functions/  Netlify Forms webhook (submission-notify.js)
├── public/admin/       Decap CMS static admin app
├── public/geo/boundaries/  Census TopoJSON boundaries for /maps (generated, committed)
├── public/previews/    Tier 1 preview files copied from the backend at build time (gitignored)
├── scripts/            sync/validation scripts (Node ESM, run directly)
└── src/
    ├── components/     Navigation.astro, etc.
    ├── content/         master-library/ — the one content collection (hand-authored + generated)
    ├── content.config.ts  Zod schema for master-library
    ├── data/geo-vocabulary.json  every state and county GEOID (Census 2025), from geo:boundaries
    ├── layouts/          Layout.astro (site shell), CommunityLayout.astro (per-community branding)
    ├── lib/
    │   ├── api/backend.ts        typed client for the live backend proxy (preview/chart/datasheet)
    │   ├── community/geoVocabulary.mjs  state and county lookups over the vocabulary (pure, tested)
    │   ├── data/coverageMap.ts    pure coverage logic for /maps (FIPS expansion, counts, labels)
    │   ├── data/staticPreview.ts  Data Preview logic over the static files (pure, tested)
    │   ├── data/libraryAccess.ts  audience-access logic (teacher/student/community + sensitive-keyword filter)
    │   └── paths.ts               withBasePath() for GH-Pages base path handling
    ├── pages/            routes — see below
    └── styles/tailwind.css
```

## Routes

Content/catalog pages:

- `/` — home, stats from the content collection + `src/data/community-submissions.json`
- `/complete-catalog` — full catalog browser with filters (theme, pedagogical tag, search, sort)
- `/master-library` — legacy redirect to `/complete-catalog`
- `/community-library` — community-submitted resources browser
- `/community-member`, `/student`, `/teacher` — audience-specific views (via `extractThemes()`/`libraryAccess.ts`)
- `/data-resources` — submission/lesson-plan links
- `/data-preview` — dataset preview from static Tier 1 files (ApexCharts); `?community=<slug>` opens that county's rows. See [previews.md](previews.md)
- `/submit` — resource submission form (Netlify Forms)
- `/maps` — county coverage map: counties shaded by how many datasets cover them, or one dataset's coverage
- `/example-community-library/{index,catalog,data-resources,map}` — a reference community-library implementation (Knox County, TN) using `CommunityLayout`

Static (build-time-rendered) API routes, `src/pages/api/*.ts`:

- `/api/complete-catalog.json` — full catalog (community-visible subset)
- `/api/master-library.json` — legacy alias of the above
- `/api/community.json` — `community-submissions.json`
- `/geo/county-names.json` — county and state names by FIPS code, for the Data Preview county picker

These are pre-rendered static files (because `output: 'static'`). The old preview API (`/api/sources`, `/api/health`) exists only in local development, through the Vite dev proxy to `npm run backend:dev`; the deployed `/data-preview` reads static files.

## Content model

The `master-library` collection (`src/content.config.ts`) validates every entry against a Zod schema: `title`, `description`, `author?`, `publishedDate?`, `category` (dataset/tool/guide/paper), `tags[]`, `dataThemes[]`, `pedagogicalTags[]`, `audienceAccess.{teacher,student,community}` (booleans, default true), `sensitive` (default false), `url`, `fileUrl`, `difficulty` (beginner/intermediate/advanced), `language`, `featured`.

Entries come from two sources:

1. **Generated** — `npm run sync:catalog` reads backend YAML sources and writes `src/content/master-library/datasets/*.md`, one per dataset, inferring frontmatter (tags, themes, difficulty) from the pipeline output.
2. **Hand-authored / CMS-edited** — non-dataset resources (guides, tools, papers) live in the same collection, editable directly or via Decap CMS.

Decap CMS (`public/admin/config.yml`) manages exactly this one collection — it does not manage `community-submissions.json` or backend YAML. In production it authenticates via `git-gateway` + Netlify Identity; locally via `npx decap-server` (`local_backend: true`).

Dataset metadata (backend YAML) is edited separately through the magic-link metadata editor on `/data-preview`; see [metadata-editor.md](metadata-editor.md).

## Coverage map

`/maps` shows where each catalog dataset applies, from its canonical `coverage` (`nation`, a state FIPS or a county FIPS, from the backend's `source_coverage`). Coverage is defined by FIPS codes only; the geometry is for display. Boundaries, the county vocabulary and the build check are described in [coverage-and-boundaries.md](coverage-and-boundaries.md).

## Data previews

Tier 1 static preview files (exported by the backend, copied at build) are described in [previews.md](previews.md).

## CI/CD

- **`ci.yml`** — on push/PR to `main`: `npm ci` → `test:functions` → `lint` (non-blocking) → `test` → `build` (hard gate, runs `prebuild`). In CI, the canonical `../backend` sibling isn't checked out, so `sync:backend-yaml`/`check:backend-yaml` no-op with a warning rather than fail — CI builds against whatever dataset content is already committed in `src/content/master-library/`.
- **`astro.yml`** — on push to `main`: builds with `astro build --site … --base …` (via `actions/configure-pages`) and deploys to GitHub Pages.
- Netlify deploys separately via its own GitHub integration (`netlify.toml`), not a workflow file in this repo.

## Known documentation staleness

A few existing docs under `web/docs/` predate the current collection name and file layout and still reference `src/content/complete-catalog` and `src/content/config.ts` (now `master-library` and `src/content.config.ts` respectively): `docs/technical/decapcms-implementation.md`, `docs/data/community-library-structure.md`, `docs/reference/job-description-data-role.md`. This document and the repo-root `ARCHITECTURE.md` reflect the current, verified names.
