# Data previews

The Data Preview page (`/data-preview?source=<id>`) shows each dataset's details, a table and
chart of its rows, and summary statistics. It reads static files only. Netlify Functions never
read or filter datasets.

## Tier 1: static preview files (every dataset with a downloadable file)

### Writing them

The backend's `pythonscripts/export_previews.py` writes the files. It uses only the Python
standard library.

```
python pythonscripts/export_previews.py            # all sources (downloads cached in data/.cache/)
python pythonscripts/export_previews.py <id>       # one source
python pythonscripts/export_previews.py --offline  # cached downloads only
```

For each source in `data/exports/catalog.json` with a `download.url`, it writes to
`data/exports/previews/<id>/`:

| File | Contents |
|---|---|
| `manifest.json` | rows, columns, sample size, county method and list, truncated counties, and a `tier2` flag (see the size budget) |
| `variables.json` | column names, variable codes when the file has a code row, types (`number`/`text`/`empty`) |
| `sample.json` | the first rows (up to 100) |
| `summary.json` | per column over every row: count, missing, distinct; min, max, mean and median for numbers; most common values for text |
| `county/<FIPS>.json` | every row for one county |

`previews/index.json` records each source as previewed (`ok`) or not, with the reason.

### What it reads

- **Formats:**
  - CSV (UTF-8 or cp1252, with an optional second header row of codes)
  - a zip with a CSV inside
  - Census-style `.xlsx` tables (merged multi-row headers are joined, footnotes dropped)
- **County detection:**
  1. a 5-digit FIPS column
  2. Census `STATE` + `COUNTY` code columns
  3. county names plus a two-letter state column, matched against the vocabulary
- **Size budget:**
  - Every file stays under 250 KB.
  - Samples drop rows until they fit (County Health Rankings, with 796 columns, keeps 41).
  - An oversized county slice is cut short and marked `truncated`.
  - Sources over 5 MB, or with a truncated slice, are flagged `tier2`.
- **Determinism:** output has no timestamps, so a re-run only changes files when the data
  changes.

### Current output

6,406 files, 23.8 MB.

| Previewed | Not previewed |
|---|---|
| 9 sources: the six Census population tables (including the two Excel ones), County Health Rankings, TRI Tennessee, USDA milk | EPA AirToxScreen: its zip holds a Microsoft Access database |
| | The 12 sources that have no direct download link |

### Into the site

- `npm run sync:previews` runs in `prebuild` and copies `data/exports/previews` from the backend
  checkout (`BACKEND_ROOT`; Netlify clones the backend for every build) into `public/previews/`.
- **Not committed in web:** `public/previews/` is gitignored, so the backend is the only committed
  copy.
- **Incremental:** only changed files are copied.
- **Checked:** the copy fails if any file is over 250 KB.
- **No backend checkout** (for example CI): the copy warns, and every dataset shows the info-only
  view.

## The page

| Part | Detail |
|---|---|
| Dataset details | Built into the page from `backend/data/exports/catalog.json`: description, tags, datasheet, preview status |
| Loaded on open | manifest, variables and sample |
| Loaded on demand | one county's rows when a county is picked; `summary.json` when its panel is opened |
| County names | `/geo/county-names.json`, built from the vocabulary |
| Chart | Drawn from the loaded rows with ApexCharts: mean of Y per X for bar and line, points for scatter |
| Very wide tables | Show the first 40 columns plus the charted ones |

### Query parameters

- `?community=<slug>` preselects that library's county slice. If the dataset has no county
  breakdown, or no rows for that county, a note says so. Community catalog links add it
  automatically.
- `?audience=teacher|student|community` shows "Opened from the … catalog view". It is read in the
  browser; a static page never sees query parameters at build time.

### Logic and local development

- **Logic:** `src/lib/data/staticPreview.ts` and `src/lib/data/previewSupport.ts`, both pure and
  tested.
- **Local development:** the old runtime API (`npm run backend:dev`, `backend/server.mjs`, proxied
  by `astro dev`) still works for backend work. Nothing on the page uses it.
