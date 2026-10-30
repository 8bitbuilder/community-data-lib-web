# Backend (mirror)

This folder mirrors the canonical backend repo for local API development.

## Source of truth

Canonical YAML lives in the sibling **`../backend`** repository (`backend/data/sources/`).
Do not edit files here directly — changes will be overwritten on the next sync.

From the web repo root:

```bash
npm run sync:backend-yaml    # copy ../backend/data/sources → backend/data/sources
npm run check:backend-yaml   # verify mirror matches canonical backend
```

Set `BACKEND_ROOT` or `BACKEND_SOURCES_DIR` in `.env` if the backend repo is elsewhere.

## SQLite

After importing in the canonical backend:

```bash
npm run backend:import       # runs import + copies database/sources.db here
```

## API

```bash
npm run backend:dev          # http://localhost:4323
```

| Endpoint | Returns |
|---|---|
| `GET /api/health` | `{ ok, previewEngine }` |
| `GET /api/sources` | All sources |
| `GET /api/sources/:id` | One source |
| `GET /api/sources/:id/datasheet` | Who / how / where / why / when summary |
| `GET /api/sources/:id/preview` | Table rows. Query: `limit`, `offset`, `state`, `county`, `columns`, plus the Excel params below. Excel responses include a `layout` object (`sheets`, `sheet`, `headerRow`, `dataRowCount`, `trimmedRows`, `origin`). |
| `GET /api/sources/:id/chart` | Chart series. Query: `variable`, `xVariable`, `plotType` (`bar`, `line`, `scatter`), `state`, `county`, `limit`, plus the Excel params. |
| `GET /api/sources/:id/filters` | Filter options. Query: `type` (`state` or `county`), `state` (for counties), plus the Excel params. |

Excel params (preview, chart, filters):

- `sheet`: the sheet's **0-based position** in the workbook (`0` = first sheet). The site always sends a position, never a name, so sheets named like numbers (`2024`) work: pick `2024` by its position. A non-numeric value is still accepted as a sheet name.
- `header_row`: the 1-based row that holds the column names.

Without them the curator's `download.sheet` / `download.header_row` from the source YAML are used, and otherwise both are detected automatically. An unknown sheet or out-of-range header row is a 400 with `code` (`UNKNOWN_SHEET` or `HEADER_OUT_OF_RANGE`) and the workbook's `sheets`.

In source YAML, `download.sheet` may be a name or a 0-based number. To name a sheet that looks like a number, quote it (`sheet: "2024"`); unquoted `sheet: 2024` means position 2024. The metadata editor treats an all-digit entry as a position.

## Pipeline (canonical backend)

```bash
npm run backend:pipeline     # variable extraction + SQLite import + mirror
```

Requires Python venv in canonical backend with pandas:

```bash
cd ../backend
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Preview/chart/filter API routes use **pandas** when available (`previewEngine: "pandas"` on `/api/health`).
Set `PREVIEW_ENGINE=node` to force the legacy Node CSV parser.
