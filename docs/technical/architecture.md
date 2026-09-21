# Web Architecture

`web/` is a static Astro site (`output: 'static'`) that renders the CDL dataset catalog for different audiences, plus a geographic marker map and a content-editing CMS. This document covers the site's structure, routing, content model, its relationship to the backend, and CI/CD. For the data-pipeline side, see [`backend/docs/PIPELINE.md`](../../../backend/docs/PIPELINE.md); for how the two projects fit together, see the repo-root [`ARCHITECTURE.md`](../../../ARCHITECTURE.md).

## Tech stack

| Concern | Choice |
|---|---|
| Framework | Astro ^6, static output (SSG) |
| UI integration | `@astrojs/react`, React 19 (used selectively; most pages are plain Astro) |
| Styling | Tailwind CSS v4 via PostCSS (Flowbite was evaluated and explicitly removed — see `docs/technical/flowbite-evaluation.md`) |
| Language | TypeScript, `astro/tsconfigs/strict`, path aliases `@components/*`, `@layouts/*`, `@content/*`, `@lib/*`, `@data/*` |
| Content layer | Astro Content Collections — one collection, `master-library`, loaded via `glob()` from `src/content/master-library/**/*.md` |
| Local backend (dev) | Plain Node `http` server mirrored at `web/backend/`, run with `node --experimental-sqlite` |
| Validation | ajv + ajv-formats + `@mapbox/geojsonhint` for GeoJSON |
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
| `prebuild` | `sync:backend-yaml && check:backend-yaml && sync:catalog` (auto-runs before `build`) |
| `build` | `astro build` |
| `validate:geo` / `validate:schema` | Both run `scripts/validate-geojson.mjs` (lint + schema check on `data/geo/markers.geojson`) |
| `lint` | `eslint . --ext .ts,.tsx,.js,.jsx,.astro` |
| `check` | `lint && validate:geo && build` — full local gate |

## Directory overview

```
web/
├── backend/            local MIRROR of ../backend (do not edit directly — see ARCHITECTURE.md)
├── data/geo/           geographic marker data, independent of the dataset pipeline
├── docs/               this documentation
├── netlify/functions/  Netlify Forms webhook (submission-notify.js)
├── public/admin/       Decap CMS static admin app
├── scripts/            sync/validation scripts (Node ESM, run directly)
└── src/
    ├── components/     Navigation.astro, etc.
    ├── content/         master-library/ — the one content collection (hand-authored + generated)
    ├── content.config.ts  Zod schema for master-library
    ├── layouts/          Layout.astro (site shell), CommunityLayout.astro (per-community branding)
    ├── lib/
    │   ├── api/backend.ts        typed client for the live backend proxy (preview/chart/datasheet)
    │   ├── data/geo.ts            loads data/geo/markers.geojson
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
- `/data-preview` — interactive dataset preview (ApexCharts), requires `backend:dev` running locally
- `/submit` — resource submission form (Netlify Forms)
- `/maps` — interactive marker map, embeds `data/geo/markers.geojson`
- `/example-community-library/{index,catalog,data-resources,map}` — a reference community-library implementation (Knox County, TN) using `CommunityLayout`

Static (build-time-rendered) API routes, `src/pages/api/*.ts`:

- `/api/geo.json` — `data/geo/markers.geojson` as `application/geo+json`
- `/api/complete-catalog.json` — full catalog (community-visible subset)
- `/api/master-library.json` — legacy alias of the above
- `/api/community.json` — `community-submissions.json`

These are pre-rendered static files (because `output: 'static'`) — distinct from the *live* backend proxy (`/api/sources`, `/api/health`), which only exists via the Vite dev proxy or `PUBLIC_API_BASE_URL` in production, and is used only by `/data-preview`.

## Content model

The `master-library` collection (`src/content.config.ts`) validates every entry against a Zod schema: `title`, `description`, `author?`, `publishedDate?`, `category` (dataset/tool/guide/paper), `tags[]`, `dataThemes[]`, `pedagogicalTags[]`, `audienceAccess.{teacher,student,community}` (booleans, default true), `sensitive` (default false), `url`, `fileUrl`, `difficulty` (beginner/intermediate/advanced), `language`, `featured`.

Entries come from two sources:

1. **Generated** — `npm run sync:catalog` reads backend YAML sources and writes `src/content/master-library/datasets/*.md`, one per dataset, inferring frontmatter (tags, themes, difficulty) from the pipeline output.
2. **Hand-authored / CMS-edited** — non-dataset resources (guides, tools, papers) live in the same collection, editable directly or via Decap CMS.

Decap CMS (`public/admin/config.yml`) manages exactly this one collection — it does not manage `data/geo/markers.geojson`, `community-submissions.json`, or backend YAML. In production it authenticates via `git-gateway` + Netlify Identity; locally via `npx decap-server` (`local_backend: true`).

## Geographic markers

Independent of the dataset pipeline. `data/geo/markers.geojson` is a GeoJSON `FeatureCollection` of `Point` features, validated against `data/geo/schema/marker.schema.json` (draft-07):

| Field | Required | Notes |
|---|---|---|
| `id` | yes | slug, `^[a-z0-9-]+$`, never change once assigned |
| `name` | yes | human-readable |
| `category` | yes | enum: `dataset`, `site`, `organization`, `event`, `other` |
| `tags` | no | array of strings |
| `region` | no | ISO 3166-1 alpha-2 or free-form label |
| `sourceUrl` | no | canonical reference link |
| `updatedAt` | no | ISO 8601 date-time |

Edit → `npm run validate:geo` → PR. See `data/geo/README.md` for full contribution guidelines and `docs/technical/geo-branching.md` for the branch-vs-separate-repo tradeoff discussion.

## CI/CD

- **`ci.yml`** — on push/PR to `main`: `npm ci` → `lint` (non-blocking) → `validate:geo` (hard gate) → `build` (hard gate, runs `prebuild`). In CI, the canonical `../backend` sibling isn't checked out, so `sync:backend-yaml`/`check:backend-yaml` no-op with a warning rather than fail — CI builds against whatever dataset content is already committed in `src/content/master-library/`.
- **`astro.yml`** — on push to `main`: builds with `astro build --site … --base …` (via `actions/configure-pages`) and deploys to GitHub Pages.
- Netlify deploys separately via its own GitHub integration (`netlify.toml`), not a workflow file in this repo.

## Known documentation staleness

A few existing docs under `web/docs/` predate the current collection name and file layout and still reference `src/content/complete-catalog` and `src/content/config.ts` (now `master-library` and `src/content.config.ts` respectively): `docs/technical/decapcms-implementation.md`, `docs/data/community-library-structure.md`, `docs/reference/job-description-data-role.md`. This document and the repo-root `ARCHITECTURE.md` reflect the current, verified names.
