# Data Cleaning Notebook & Excel Support — Design

Date: 2026-10-30
Repos: `web` (primary), `backend` (small schema companion change)

## Intent

Teachers and students currently look at a dataset on the Data Preview page, then leave the
site to clean it in Jupyter, Excel, or another tool. We want them to stay: open the dataset
in a notebook embedded in the preview page, clean it with preset operations, and export the
result.

The notebook is a **teaching tool**. Non-coders drive it with dropdown menus, but every menu
action writes a visible, commented pandas cell, so students see (and can edit) the code behind
each step. Hiding the code would defeat the purpose.

Alongside this, Excel datasets (`.xlsx`/`.xls`) get full support: the same table, chart, and
filters CSV datasets get today. Excel was previously blocked because government workbooks
often don't render correctly (title rows, multiple sheets, footnotes). This design addresses
that directly.

## Goals

1. **Notebook on the Data Preview page** that runs Python (pandas) in the visitor's browser.
2. **Automatic data loading**: the dataset opens in the notebook without the visitor
   downloading it first. Uploading a local file (CSV/TSV/XLSX/XLS) is also supported.
3. **Guided actions** (dropdown menus) that insert commented pandas cells:
   - Drop columns (multi-select)
   - Drop rows (by row index/range, or by condition: column / operator / value)
   - Drop missing values (all columns, or selected columns; "any" vs "all")
   - Fill missing values: column(s) + strategy (mean, median, mode, constant value)
   - Rename column
   - Change column type (number, text, date)
   - Filter rows (keep rows where column / operator / value)
   - Remove duplicate rows
4. **Free editing**: every cell is editable; visitors can add blank code cells.
5. **Live view** of the current `df` (shape plus first rows) after each run.
6. **Export** cleaned data as CSV or Excel, and the steps as a `.ipynb` file teachers can
   distribute.
7. **Excel datasets get full preview** (table, chart, state/county filters, variable
   dropdowns), with sheet/header handling in three layers: curator default, auto-detection,
   visitor override.

## Non-goals

- Saving cleaned datasets back to the site or catalog. Output is a download only.
- Accounts, sharing notebooks between users, or server-side Python execution.
- Charts/plotting inside the notebook (the page already has a chart; may come later).
- Handling files larger than the pass-through limit (~6 MB) through auto-load; those use
  upload.
- Fixing merged/multi-row Excel headers automatically. We pick one header row; anything more
  complex is the curator's or visitor's call (or a cleaning step).

## Anti-goals (failures even if it "works")

- Dropdown actions that change data without leaving visible code. Every action must be a cell.
- Generated code that's clever instead of readable. It should look like what a teacher writes
  on a board: one operation per cell, plain pandas, a one-line comment saying what it does.
- The notebook slowing down the existing preview. Pyodide must load lazily, only when the
  visitor opens the notebook section.
- An Excel dataset showing a garbage table ("Table 1. Annual Estimates…" as column headers)
  with no way for the visitor to fix it.

## Current state (what exists)

- `web/src/pages/data-preview.astro` (~1,480 lines): Astro page with an inline client
  `<script>`. Loads source metadata, table (`fetchPreview`), chart (ApexCharts from jsDelivr),
  state/county filters. Sources without a download URL or with Excel URLs show "Info only"
  via `src/lib/data/previewSupport.ts`.
- Preview API: `web/backend/lib/apiHandler.mjs` (shared routes), served by
  `netlify/functions/preview-api.mjs` in production (Node engine) and
  `web/backend/server.mjs` locally (may use the pandas engine,
  `backend/lib/pandasPreview.mjs` → `backend/pythonscripts/preview_data.py`).
- `web/backend/lib/csvCache.mjs` downloads the source file server-side, unzips if needed,
  parses CSV, caches per source. It **rejects Excel** explicitly.
- Source metadata lives as YAML in the **backend** repo (`data/sources/*.yml`), flows through
  SQLite (`database/schema.sql`, columns `download_url`, `download_description`,
  `download_file_size`) into `web/backend/data/exports/catalog.json`
  (`sourceFromSqlite.mjs` → `buildDownload`).
- Metadata editor: `netlify/functions/metadata-edit.mjs` + `_lib/editableFields.mjs` opens a
  PR against the backend repo's YAML. `download` is currently edited as `{ url }` only.
- Current catalog: 5 CSV sources (census.gov ×4, usda.gov ×1), 17 KB–2 MB. **Neither host
  sends CORS headers**, so the browser cannot fetch them directly (verified 2026-10-30).

## Design

### 1. File pass-through route

New action on the existing API: `GET /api/sources/:id/file`.

- Downloads `source.download.url` server-side (reuse `downloadBytes`), unzips if it's a zip
  containing a single tabular file (reuse `pickFileFromZip`), and returns the raw bytes with
  the right `Content-Type` and a `Content-Disposition` filename.
- Reuses the existing in-memory cache keyed by source id (store raw bytes alongside the parsed
  table, so a preview and a notebook load don't download twice).
- If the file exceeds the size limit (configurable; default 4 MB, because Netlify
  base64-encodes binary function responses and caps them at ~6 MB), return `413` with a JSON body `{ error, size, downloadUrl }`. The
  notebook shows: "This file is too large to open automatically. Download it with the button
  above, then use Upload."
- Works in both runtimes because it lives in the shared `apiHandler`.

### 2. Excel parsing (server)

Add Excel support to `csvCache.mjs` → rename/generalize to a tabular loader (builder's call
on naming).

- **Library:** SheetJS (`xlsx`). The sheet/header/footnote logic lives in **one isomorphic
  JS module** (e.g. `src/lib/data/excelLayout.mjs`) that takes workbook bytes and returns
  `{ headers, rows, layout }`. The server imports it, and the browser imports the same module
  for uploaded Excel files (see §5), so the heuristic is written once.
- **Engines:** Excel sources always use the Node engine, even when the local server would
  otherwise use pandas (`pandasPreview.mjs` / `preview_data.py` stay CSV-only). This avoids a
  second Python copy of the heuristic.
- **Sheet choice** (in priority order):
  1. visitor override (query param `sheet`)
  2. curator default `download.sheet` (sheet name or 0-based index)
  3. auto: the first sheet whose detected data region has ≥ 2 columns and ≥ 2 data rows
- **Header row** (in priority order):
  1. visitor override (query param `header_row`, 1-based as people count rows in Excel)
  2. curator default `download.header_row` (1-based)
  3. auto-detect: scan the first 20 rows; choose the first row where ≥ 60% of the cells in
     the sheet's used column range are non-empty and the majority are non-numeric text, and
     the following row is also populated. Fallback: row 1.
- **Footnote trimming:** after the header, stop at the first run of rows where only the first
  cell is populated *and* it starts with a footnote-ish pattern (`Note`, `Source`,
  `Footnote`, `*`, `(X)`, a digit followed by `.` or `)`), or at 2+ consecutive fully blank
  rows. Trimmed trailing rows are dropped.
- Cell values are formatted strings as Excel displays them (SheetJS `raw: false`), except
  dates, which become ISO `YYYY-MM-DD`. This keeps the existing string-based table/chart code
  working unchanged.
- The parsed table carries a `layout` object: `{ format: 'xlsx' | 'xls', sheet, sheets:
  [...names], headerRow, dataRowCount, detected: { sheet: bool, headerRow: bool },
  trimmedRows }`. `dataRowCount` is the number of data rows kept after footnote trimming, so
  the notebook can reproduce the same region with pandas (`nrows=`). The cache key
  includes sheet and header row.
- `/preview`, `/chart`, `/filters` accept `sheet` and `header_row` query params and pass them
  through. Responses include `layout` so the page can show and populate dropdowns.

### 3. Curator defaults (backend repo + editor)

- **backend repo:** add optional `download.sheet` (string or integer) and
  `download.header_row` (integer ≥ 1) to source YAML. Add `download_sheet TEXT`,
  `download_header_row INTEGER` to `database/schema.sql` and the import/export pipeline.
  Document in `docs/API.md`.
- **web:** `sourceFromSqlite.mjs` → `buildDownload` includes the two fields;
  `scripts/sync-backend-yaml.mjs` / `check-backend-yaml-sync` pick them up as needed.
- **Metadata editor:** `editableFields.mjs` `pickEditable` / `validateChanges` /
  `toTopLevelUpdates` handle `download.sheet` and `download.header_row`; `changes.mjs`
  `diffFields` diffs them; `MetadataEditor.astro` shows two inputs under Download URL, visible
  only when the URL ends in `.xlsx`/`.xls`. Labeled "Excel sheet (name or number)" and
  "Header row (row number in Excel)". Blank means auto-detect.
- Order of delivery: web reads the fields if present and treats them as optional, so web can
  ship before the backend change lands.

### 4. Preview page changes for Excel

- `previewSupport.ts`: Excel URLs are previewable; only "no download URL" stays info-only.
  Remove the "Info only" badge for Excel.
- When the loaded table's `layout.format` is Excel, show a small bar above the table:
  `Sheet ▾ [names]` and `Header row ▾ [1–20]`, preselected from `layout`, plus a note:
  "Read from sheet 'Data', header on row 4 (auto-detected)" or "(set by curator)".
- Changing either dropdown re-fetches preview/chart/filters with the new params. The override
  lives in page state for this visit (and in the URL query string, so a teacher can share a
  link with the right sheet). It also updates the notebook's load cell (see below).

### 5. Notebook UI

A new section "Clean this data" at the bottom of the preview page, collapsed by default with
an "Open notebook" button. The button triggers the Pyodide load. Built as a React island
(`@astrojs/react` is already a dependency) so its state stays manageable. The existing page
script stays as-is apart from the hooks it needs.

**Runtime**
- Pyodide (pinned version from `cdn.jsdelivr.net`, consistent with ApexCharts), running in a
  **Web Worker** so the page stays responsive. Packages: `pandas`, `openpyxl` (for
  `read_excel` / `to_excel` on xlsx); `xlrd` via micropip for `.xls` if available, otherwise
  `.xls` files are converted to xlsx bytes in the browser with SheetJS before handing to
  Python (builder's call after checking Pyodide package availability).
- Loading UI: progress text ("Loading Python… / Loading pandas… / Loading dataset…").
  Expect a few seconds on first open; the browser caches afterwards.
- Interrupt: a "Stop" button terminates and restarts the worker (re-running cells from the
  top is the recovery path).

**Loading the data**
- On open, the first cell is generated and run automatically:
  ```python
  # Load the dataset into a table called df
  import pandas as pd
  df = pd.read_csv("co-est2025-alldata.csv")
  ```
  For Excel, the load cell reproduces the **same data region as the preview table**, using
  the effective layout from section 2:
  ```python
  # Load the "Data" sheet. The real column names are on row 4, so skip the 3 title rows.
  # nrows=52 stops before the footnotes at the bottom of the sheet.
  df = pd.read_excel("file.xlsx", sheet_name="Data", skiprows=3, nrows=52)
  ```
  The `skiprows`/`nrows` comment lines appear only when they're non-trivial. Values are
  pandas' raw values (real numbers, not Excel's "1,234" display strings), which is
  intentionally better for cleaning; only formatting differs from the preview table, not
  rows or columns. The bytes come from `/api/sources/:id/file` and are
  written into Pyodide's virtual filesystem under the original filename, so the code reads
  like what students would write on their own machine.
- Encoding: the CSV cell uses `encoding="latin-1"` only when the server detected non-UTF-8
  (builder detects; Census files are sometimes latin-1).
- If the pass-through fails (413, network, upstream error), show the reason and an
  **Upload** drop zone. Upload is also always available ("Use my own file") and replaces the
  load cell with one for the uploaded filename.
- **Uploaded Excel files** run through the same isomorphic layout module in the browser, so
  they get auto-detection and the notebook shows its own `Sheet ▾` / `Header row ▾`
  dropdowns that regenerate the load cell. (These notebook dropdowns don't affect the
  preview table above, which always shows the catalog dataset.)
- Changing sheet/header in the Excel bar regenerates the load cell. If later cells exist, ask:
  "Reload data and re-run all steps?"

**Cells**
- Each cell: code editor (CodeMirror 6 with Python highlighting; builder may choose a lighter
  editor if bundle size matters), Run button, output area (stdout, errors, or a table if the
  last expression is a DataFrame).
- Toolbar: `Run all`, `+ Code cell`, the action menu, `Export ▾`, `Reset`.
- Cells can be deleted and moved up/down. Running is explicit; cells show a stale marker when
  an earlier cell changed since they last ran.
- Python errors show the last line prominently ("KeyError: 'POPESTIMATE2030'") with the full
  traceback collapsible.

**Live data view**
- Below the toolbar, a panel always shows the current `df`: `rows × columns`, a missing-value
  count per column (helps students decide what to drop or fill), and the first 50 rows. It
  refreshes after each run. If `df` is not a DataFrame, the panel says so.

**Guided actions (dropdown menus)**
- `+ Cleaning step ▾` opens a menu of the actions in Goals §3. Each opens a small inline form
  whose column pickers are populated from the current `df` columns (fetched from the worker).
  Inputs are validated (e.g. mean/median only offered for numeric columns).
- Submitting inserts a new cell after the selected cell (or at the end) **and runs it**.
- Code templates (exact wording is the builder's; keep this style):
  ```python
  # Drop columns we don't need
  df = df.drop(columns=["SUMLEV", "REGION"])
  ```
  ```python
  # Fill missing values in POPESTIMATE2020 with the column's median
  df["POPESTIMATE2020"] = df["POPESTIMATE2020"].fillna(df["POPESTIMATE2020"].median())
  ```
  ```python
  # Keep only rows where STNAME is "Tennessee"
  df = df[df["STNAME"] == "Tennessee"]
  ```
  ```python
  # Drop rows that have any missing values
  df = df.dropna()
  ```
  Use reassignment (`df = ...`), never `inplace=True`. Quote values correctly for strings vs
  numbers. Escape column names safely (generated with Python `repr`-equivalent escaping).
- Generated cells are ordinary cells: freely editable afterward.

**Persistence**
- Cells (code only, not outputs) are saved in `localStorage` keyed by source id, wrapped in
  try/catch. Reopening the notebook restores the cells and offers "Run all". `Reset` clears
  them and regenerates the load cell.

**Export**
- `Export ▾`:
  - **Cleaned data → CSV** (`df.to_csv(index=False)`)
  - **Cleaned data → Excel** (`df.to_excel(..., index=False)` via openpyxl)
  - **Notebook → .ipynb**: nbformat v4 JSON built in JS from the cells; outputs omitted.
    The load cell is rewritten so the notebook runs unchanged in Jupyter/Colab:
    - plain CSV/Excel URL: read straight from the URL with a browser-like User-Agent
      (`storage_options={"User-Agent": "Mozilla/5.0"}`), since some hosts reject Python's
      default.
    - zip URL: a short `urllib` + `zipfile` cell that downloads, opens the same inner file the
      server picked, then reads it.
    - uploaded file: keeps `pd.read_csv("<filename>")` with a comment telling the reader to
      put the file next to the notebook (or upload it in Colab).
    Each generated load cell for export is unit-tested.
- Exports are downloads only; they don't add cells to the notebook. Filenames:
  `<source-id>-cleaned.csv`, `.xlsx`, `<source-id>-notebook.ipynb`.

### 6. Accessibility & layout

- All controls are keyboard reachable; dropdown forms use real `<label>`/`<select>`.
- The notebook stacks to one column on narrow screens; the data view scrolls horizontally
  inside its own container (the page itself must not scroll sideways).
- Matches existing page styles (reuse `section-title`, `btn-download`, card styles).

## Testing

- **Unit (node --test):** Excel loader: sheet selection, header auto-detection, footnote
  trimming, curator/visitor precedence. Use small fixture workbooks committed under
  `web/tests/fixtures/` covering: clean single sheet; 4 title rows above header;
  notes sheet first then data sheet; trailing footnotes; `.xls`; a zip containing an xlsx.
- **Unit:** code generators for each guided action (input → exact code string), including
  column names with spaces/quotes and string vs numeric values.
- **Unit:** `.ipynb` export produces valid nbformat v4 JSON.
- **Unit:** editor field validation and diffing for `download.sheet` / `download.header_row`
  (extend existing `editableFields.test.mjs`, `changes.test.mjs`).
- **API:** `/file` returns bytes and correct headers; 413 above the limit; `/preview` honors
  `sheet`/`header_row`.
- **Manual/browser:** open notebook on a CSV source and an Excel fixture source, run each
  guided action, export all three formats, open the `.ipynb` in Jupyter.

## Decided by the user

- Notebook embedded in the Data Preview page, for teachers, educators, students.
- Dropdowns generate **visible** code so students learn from it.
- Preset actions: remove columns, remove rows, drop missing values, impute mean/median (and
  similar).
- Data loads directly from the source when possible (via our server).
- Excel datasets get **full preview**, not just notebook support.
- Both curator-set sheet/header defaults **and** visitor dropdown overrides.

## Builder's / Claude's calls (flagged for review)

- Python runs in-browser via Pyodide (no server kernel, no cost per user, data stays local).
- Extra actions beyond the user's list: rename, change type, filter rows, remove duplicates.
- Exports: CSV, Excel, `.ipynb`.
- Cells persist per dataset in the visitor's browser.
- Notebook is a React island, lazy-loaded behind "Open notebook".
- Header-detection heuristic thresholds (60%, first 20 rows) and footnote patterns. No real
  Excel datasets are planned yet (user, 2026-10-30), so these are tuned against hand-made
  sample workbooks modeled on typical Census/USDA layouts. Revisit when the first real Excel
  source is added. No Excel source is added to the catalog as part of this work; the manual
  browser test uses a local dev-only source pointing at a fixture.
- 5.5 MB auto-load limit.
- Header row is 1-based everywhere a person sees it.
- Auto-load limit lowered to 4 MB (Netlify base64 overhead).
- Excel always uses the Node engine; the pandas engine stays CSV-only.
- One isomorphic JS module for Excel layout, shared by server and browser uploads.
- The notebook's Excel `df` matches the preview's rows/columns via `skiprows` + `nrows`.
- Exported `.ipynb` must run unchanged in Jupyter/Colab (URL, zip, and upload cases).
- Scope in the **backend repo** is the schema/pipeline fields only. Its separate preview
  server (`backend/server.mjs`, `backend/lib/*`) and analysis scripts
  (`pythonscripts/anova.py` etc.) are not changed; the website is served from the web repo's
  copy.
- (Added during planning) Header detection treats 4-digit years (1800–2100) as text-like,
  since government tables often use years as column names. `layout.detected` is replaced
  by `layout.origin: { sheet, headerRow }` (`'visitor' | 'curator' | 'auto'`) so the page
  can say where each choice came from.

## Change (2026-10-30, after launch): upload only

To avoid redistributing datasets, the notebook no longer loads data automatically. Visitors
download the file from the original provider (link shown in the notebook) and upload it.
The `/api/sources/:id/file` pass-through route and `PREVIEW_FILE_MAX_BYTES` are removed;
the site never serves raw dataset files. Uploaded Excel workbooks reuse the preview's
sheet/header row (if the workbook has that sheet), then the curator defaults, then
auto-detection. Exported notebooks load the uploaded file from next to the notebook. The
"preview layout changed" prompt is gone (the notebook's file is always the visitor's copy).
