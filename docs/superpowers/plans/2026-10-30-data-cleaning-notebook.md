# Data Cleaning Notebook & Excel Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add full Excel preview (with curator/auto/visitor sheet + header-row choice) and an in-browser pandas notebook with guided, code-visible cleaning actions to the Data Preview page.

**Architecture:** One isomorphic JS module (SheetJS) decides an Excel file's sheet, header row and data region; the preview API uses it server-side and the notebook uses it for uploads. A new `/api/sources/:id/file` route passes the raw file through to the browser, where Pyodide runs pandas in a Web Worker behind a React island. All generated Python comes from one pure, unit-tested codegen module.

**Tech Stack:** Astro 6 + React 19 islands, Node 22 `node:test`, Netlify Functions, SheetJS 0.20.3 (CDN tarball), Pyodide 0.27.2 (jsDelivr), CodeMirror 6, Python 3 + pandas (backend repo, local pandas engine).

**Spec:** `docs/superpowers/specs/2026-10-30-data-cleaning-notebook-design.md` — read it alongside this plan.

## Global Constraints

- Two repos: `web` = `/Users/arielthompson/Documents/CDL/web`, `backend` = `/Users/arielthompson/Documents/CDL/backend`. Work on branch `feature/data-cleaning-notebook` in each (both currently on `main`). In `backend`, never stage the pre-existing modified file `docs/superpowers/plans/2026-08-11-dataset-tagging-fix.md`.
- Every dropdown action produces a **visible, editable** cell. No action mutates data without a cell.
- Generated code: one operation per cell, plain pandas, a one-line `#` comment first, `df = ...` reassignment, **never `inplace=True`**.
- Header row is **1-based** everywhere a person sees it (UI, YAML `download.header_row`, query param `header_row`). `sheet` may be a sheet name or a 0-based index.
- Precedence for sheet and header row: visitor override → curator default (`download.sheet` / `download.header_row`) → auto-detect.
- Auto-load limit: env `PREVIEW_FILE_MAX_BYTES`, default **4_000_000** bytes. Above it `/file` returns **413** `{ error, size, downloadUrl }`.
- Excel sources always use the Node preview engine; the pandas engine stays CSV-only.
- Pyodide loads **only** after the visitor clicks "Open notebook"; it runs in a Web Worker. Pin `https://cdn.jsdelivr.net/pyodide/v0.27.2/full/`.
- SheetJS: install from the vendor tarball, **not** the npm registry (registry `xlsx@0.18.5` has known CVEs): `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- `localStorage` access is always wrapped in try/catch; the notebook must work without it.
- Export filenames: `<source-id>-cleaned.csv`, `<source-id>-cleaned.xlsx`, `<source-id>-notebook.ipynb`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Test commands: web `npm test` (tests/*.test.ts), `npm run test:functions` (netlify + editor .mjs tests); backend `python3 -m unittest discover pythonscripts/tests`.

## Review Focus

1. **Blank or duplicate Excel header cells** (merged headers leave blanks): column names must match what pandas produces (`Unnamed: 3`, `Name.1`), or generated code will reference columns that don't exist in `df`. → Task 2 test `pandas-compatible names for blank and duplicate headers`; Task 8 python cross-check.
2. **Stale shared link** with `?sheet=Old&header_row=40` where the sheet no longer exists or the row is past the end: page shows a short message and falls back to the curator/auto choice instead of a broken preview. → Task 3 test `unknown sheet and out-of-range header row are 400 with sheet list`; Task 5 step for the fallback.
3. **Workbook with no usable data** (empty sheet, header but no rows): a clear 422 "This sheet has no data rows", not a 500. → Task 2 test `empty sheet throws NoDataError`.
4. **Restored notebook whose dataset file changed**: the load cell is always regenerated from the current file; only cells after it are restored. → Task 9 test `restore replaces the load cell`.
5. **Stop / worker crash mid-run**: worker restarts, the file is rewritten into the new Python filesystem, every cell is marked stale, nothing hangs on "Running…". → Task 9 manual check steps.

---

## File Structure

**backend repo**
- Modify `database/schema.sql`, `pythonscripts/import_sources_to_sqlite.py`, `pythonscripts/export_catalog.py`, `docs/API.md`
- Test `pythonscripts/tests/test_import_sources.py`, `pythonscripts/tests/test_export_catalog.py`

**web repo**
- Create `src/lib/data/excelLayout.mjs` — isomorphic: workbook bytes + options → `{ headers, rows, layout }`.
- Modify `backend/lib/csvCache.mjs` — raw-file cache, Excel branch, `getSourceFile`.
- Modify `backend/lib/dataPreview.mjs`, `backend/lib/apiHandler.mjs`, `backend/lib/sourceFromSqlite.mjs`.
- Modify `src/lib/api/backend.ts`, `src/lib/data/previewSupport.ts`, `src/pages/data-preview.astro`.
- Modify `netlify/functions/_lib/editableFields.mjs`, `src/lib/editor/changes.mjs`, `src/components/MetadataEditor.astro`.
- Create `src/components/notebook/`:
  - `codegen.ts` — all generated Python + `.ipynb` JSON (pure).
  - `notebookStore.ts` — localStorage persistence + cell-list helpers (pure).
  - `helpers.py` — Python run/inspect/export helpers, loaded into Pyodide (imported with `?raw`).
  - `pyodideWorker.ts` — Web Worker.
  - `usePyodide.ts` — React hook wrapping the worker protocol.
  - `Notebook.tsx`, `Cell.tsx`, `DataView.tsx`, `ActionMenu.tsx`, `ExportMenu.tsx`, `UploadZone.tsx`, `notebook.css`.
- Tests: `tests/excelLayout.test.ts`, `tests/fixtures/make-excel-fixtures.mjs` (+ generated `tests/fixtures/*.xlsx|xls`, `tests/fixtures/expected.json`), `tests/previewApi.test.ts` (extend), `tests/previewSupport.test.ts` (update), `tests/notebookCodegen.test.ts`, `tests/notebookStore.test.ts`, `tests/notebook_helpers_test.py`.

---

### Task 1: Curator fields `download.sheet` / `download.header_row` through the pipeline

**Files:**
- Modify: `backend/database/schema.sql`, `backend/pythonscripts/import_sources_to_sqlite.py` (`ADDED_SOURCE_COLUMNS`, insert ~L233-270), `backend/pythonscripts/export_catalog.py` (~L88-93), `backend/docs/API.md`
- Modify: `web/backend/lib/sourceFromSqlite.mjs` (`buildDownload`), `web/src/lib/api/backend.ts` (`SourceDownload`)
- Test: `backend/pythonscripts/tests/test_import_sources.py`, `backend/pythonscripts/tests/test_export_catalog.py`

**Interfaces:**
- Produces: source objects whose `download` may carry `sheet: string | number` and `header_row: number` (≥ 1). Absent when unset. TS: `SourceDownload { url?; description?; file_size?; sheet?: string | number; header_row?: number }`.

- [ ] **Step 1: Create branches** — in both repos: `git checkout -b feature/data-cleaning-notebook`.
- [ ] **Step 2: Write failing tests** in `test_import_sources.py`:
  - `test_excel_layout_fields_are_stored`: YAML with `download: {url: https://x.gov/a.xlsx, sheet: Data, header_row: 4}` → row `download_sheet == "Data"`, `download_header_row == 4`.
  - `test_numeric_sheet_index_is_stored_as_text`: `sheet: 1` → `download_sheet == "1"`.
  - `test_invalid_header_row_skips_the_source`: `header_row: 0` and `header_row: "four"` → source skipped (same mechanism as `test_invalid_values_skip_the_source`).
  - Extend `test_existing_database_gets_new_columns` to assert both new columns exist on an old DB.
  - In `test_export_catalog.py` `test_export_sheet_and_header_row`: sheet `"Data"` → `download.sheet == "Data"`; sheet stored `"1"` → `download.sheet == 1` (int); header_row → int; unset → keys absent.
- [ ] **Step 3: Run** `python3 -m unittest discover pythonscripts/tests` — expect the new tests to FAIL.
- [ ] **Step 4: Implement.** Columns `download_sheet TEXT`, `download_header_row INTEGER CHECK (download_header_row >= 1)` in `schema.sql` and `ADDED_SOURCE_COLUMNS`. Importer validates (`header_row` must be int ≥ 1; `sheet` str or int ≥ 0) and stores. Exporter: `sheet` that is all digits → int; include via `_drop_empty`.
- [ ] **Step 5: Run** backend tests — PASS.
- [ ] **Step 6: web side.** `buildDownload` copies `row.download_sheet` (digits → number) and `row.download_header_row`; extend `SourceDownload`. Document both fields in `backend/docs/API.md` (YAML example + "blank = auto-detect").
- [ ] **Step 7: Run** web `npm test` — PASS (no regressions).
- [ ] **Step 8: Commit** in each repo (`feat: add download.sheet and download.header_row source fields`).

---

### Task 2: Isomorphic Excel layout module

**Files:**
- Create: `web/src/lib/data/excelLayout.mjs`, `web/tests/fixtures/make-excel-fixtures.mjs`, generated fixtures, `web/tests/excelLayout.test.ts`
- Modify: `web/package.json` (SheetJS dep, script `"fixtures:excel": "node tests/fixtures/make-excel-fixtures.mjs"`)

**Interfaces:**
- Produces (JSDoc-typed, importable from Node and the browser via `import * as XLSX from 'xlsx'`):
  ```js
  /** @typedef {'visitor'|'curator'|'auto'} LayoutOrigin */
  /** @typedef {{ format: 'xlsx'|'xls', sheets: string[], sheet: string, headerRow: number,
   *   dataRowCount: number, trimmedRows: number,
   *   origin: { sheet: LayoutOrigin, headerRow: LayoutOrigin } }} ExcelLayout */
  export function readExcelTable(bytes /* Uint8Array */, options = {}
    /* { visitor?: { sheet?: string|number|null, headerRow?: number|null },
         curator?: { sheet?: string|number|null, headerRow?: number|null } } */)
    // → { headers: string[], rows: string[][], layout: ExcelLayout }
  export function detectHeaderRow(grid /* string[][] */) // → 1-based row number
  export function findDataEnd(grid, headerIndex /* 0-based */) // → 0-based exclusive end index
  export function pandasColumnNames(rawHeaders /* string[] */) // → string[]
  export class LayoutError extends Error { /* .code: 'NO_DATA'|'UNKNOWN_SHEET'|'HEADER_OUT_OF_RANGE'; .sheets: string[] */ }
  ```
- `dataRowCount` = number of sheet rows from the row after the header through the last kept data row (blank rows inside the region included), i.e. the value for pandas `nrows=`. `trimmedRows` = sheet rows dropped after the region.

**Algorithm (decided; thresholds from the spec):**
- Grid: `XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '', blankrows: true, dateNF: 'yyyy-mm-dd' })`, cells trimmed. Read workbook with `{ type: 'array', cellDates: true }`. Used columns = sheet `!ref` range.
- Header: among the first 20 rows, the first row where ≥ 60% of used-range cells are non-empty, more than half of its non-empty cells are text-like, and the next row has ≥ 1 non-empty cell. Fallback 1. **Text-like** = non-numeric, *or* a 4-digit integer 1800–2100 (Census/USDA tables commonly use years as column headers; refinement of the spec's "non-numeric text" rule).
- Data end: walk down from the header; stop before (a) 2+ consecutive fully blank rows, or (b) a row where only the first cell is non-empty and it matches `/^(note|source|footnote|\*|\(x\)|\d+[.)])/i` — everything from there is trimmed. Trailing blank rows inside the kept range are also removed.
- Auto sheet: first sheet whose detected region has ≥ 2 columns and ≥ 2 data rows; else first sheet.
- Rows returned exclude fully blank rows (pandas skips them too).
- Names: blank header at 0-based column `i` → `Unnamed: i`; repeats → `name.1`, `name.2` (pandas mangling).

- [ ] **Step 1: Add SheetJS** — `npm i https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`.
- [ ] **Step 2: Write the fixture generator** `make-excel-fixtures.mjs` building with `XLSX.utils.aoa_to_sheet` + `XLSX.write`, writing to `tests/fixtures/`: `clean.xlsx` (header row 1, 3 rows); `title-rows.xlsx` (3 title rows, header on row 4, 5 data rows, then blank + `Source: U.S. Census Bureau` + `1. Estimates are…`); `notes-first.xlsx` (sheet `Notes` with prose, sheet `Data` with a table); `blank-dup-headers.xlsx` (headers `['State', '', 'Pop', 'Pop']`); `empty.xlsx` (one empty sheet); `legacy.xls` (`bookType: 'biff8'`, same as `clean`). It also writes `expected.json`: for each file, `{ sheet, headerRow, dataRowCount, headers, rowCount }` from `readExcelTable` (used by Task 8's pandas cross-check). Run `npm run fixtures:excel` and commit outputs.
- [ ] **Step 3: Write failing tests** in `tests/excelLayout.test.ts` (read fixtures with `readFileSync`):
  - `clean sheet: header row 1, all rows` → headers match, `layout.origin` both `'auto'`, `trimmedRows === 0`.
  - `title rows are skipped and footnotes trimmed` (`title-rows.xlsx`) → `headerRow === 4`, `rows.length === 5`, `dataRowCount === 5`, `trimmedRows === 3`, no row contains `Source:`.
  - `auto picks the data sheet over a notes sheet` → `sheet === 'Data'`, `sheets` deep-equals `['Notes', 'Data']`.
  - `curator default beats auto, visitor beats curator` → curator `{ sheet: 'Notes' }` gives `origin.sheet === 'curator'`; adding visitor `{ sheet: 'Data', headerRow: 1 }` gives `'visitor'` for both.
  - `sheet may be a 0-based index` → visitor `{ sheet: 1 }` selects `'Data'`.
  - `pandas-compatible names for blank and duplicate headers` → `['State', 'Unnamed: 1', 'Pop', 'Pop.1']`.
  - `unknown sheet and out-of-range header row throw LayoutError` → codes `UNKNOWN_SHEET` (with `.sheets`) and `HEADER_OUT_OF_RANGE`.
  - `empty sheet throws NoDataError` → `LayoutError` code `NO_DATA`.
  - `xls files are read` → `layout.format === 'xls'`, same headers as `clean`.
  - `detectHeaderRow` / `findDataEnd` unit cases on small literal grids: `[['Table 1','',''],['','',''],['Area','2020','2021'],['Knox','1','2']]` → 3 (year labels count as text-like); `[['Area','Pop'],['5','6'],['7','8']]` → 1; a grid whose candidate row is `['Area','12.5','99']` with data below → not that row (numbers aren't years); `findDataEnd` stops at `['Source: Census','','']` and at two blank rows.
- [ ] **Step 4: Run** `npm test` — FAIL (module missing).
- [ ] **Step 5: Implement** `excelLayout.mjs` per the interface and algorithm above. Format from the workbook (`wb.bookType` or magic bytes: zip → xlsx, `D0 CF 11 E0` → xls).
- [ ] **Step 6: Run** `npm test` — PASS.
- [ ] **Step 7: Commit** (`feat: add Excel layout detection module`).

---

### Task 3: Server loader, `/file` route, sheet/header params

**Files:**
- Modify: `web/backend/lib/csvCache.mjs`, `web/backend/lib/dataPreview.mjs`, `web/backend/lib/apiHandler.mjs`
- Test: `web/tests/previewApi.test.ts`

**Interfaces:**
- Consumes: `readExcelTable`, `LayoutError` (Task 2) via `../../src/lib/data/excelLayout.mjs`.
- Produces:
  - `getSourceFile(source) → Promise<{ bytes: Buffer, filename: string, format: 'csv'|'tsv'|'xlsx'|'xls', archive: 'zip'|null }>` — raw bytes after unzip; `filename` = inner name for zips, else last URL path segment. Cached per source id (15-min TTL as today).
  - `getSourceTable(source, { sheet?, headerRow? } = {}) → Promise<{ headers, rows, layout?: ExcelLayout }>` — cache key `${id}|${sheet ?? ''}|${headerRow ?? ''}`; curator values from `source.download`.
  - `buildPreview(source, options)` / `buildChart(source, options)` accept `options.sheet`, `options.headerRow`; `buildPreview` returns `layout` when present. `listFilterOptions(source, filterType, parentFilter, tableOptions = {})`.
  - Routes: `GET /api/sources/:id/file` → 200 binary, headers `Content-Type` (`text/csv`, `text/tab-separated-values`, xlsx/xls MIME), `Content-Disposition: attachment; filename="<filename>"`, `X-CDL-Filename`, `X-CDL-Format`, `X-CDL-Archive` (`zip` or absent), `Access-Control-Expose-Headers` listing the three. `/preview`, `/chart`, `/filters` read `sheet` (digits → number) and `header_row` (int).
  - Errors: `LayoutError` `UNKNOWN_SHEET`/`HEADER_OUT_OF_RANGE` → 400 `{ error, code, sheets }`; `NO_DATA` → 422 `{ error: "This sheet has no data rows", code }`; size > limit → 413 `{ error: "File too large to open automatically", size, downloadUrl }`.

- [ ] **Step 1: Write failing tests** in `previewApi.test.ts` (extend the local fixture server to serve `tests/fixtures/*` and a zip containing `title-rows.xlsx` built with `adm-zip`):
  - `file route returns raw CSV bytes with filename headers` → body equals the CSV; `X-CDL-Filename === 'counties.csv'`; `X-CDL-Format === 'csv'`.
  - `file route unzips and reports the inner file` → `X-CDL-Archive === 'zip'`, `X-CDL-Filename === 'title-rows.xlsx'`.
  - `file route returns 413 above PREVIEW_FILE_MAX_BYTES` (set env to `10` for the test, restore after) → status 413, body has `size` and `downloadUrl`.
  - `Excel preview returns rows and layout` (`title-rows.xlsx` source) → 200, `layout.headerRow === 4`, `total === 5`.
  - `curator header_row is honored and visitor param overrides it` → source with `download.header_row: 1` gives `layout.origin.headerRow === 'curator'`; `?header_row=4` gives `'visitor'`.
  - `unknown sheet and out-of-range header row are 400 with sheet list` → `?sheet=Nope` 400 with `sheets`; `?header_row=99` 400.
  - `Excel sources skip a preferred pandas engine` → handler built with a fake engine whose methods throw if called; Excel preview still 200 with `engine === 'node'` and no `pandasFallback`.
  - Update any existing test that expected Excel → 422.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement.** In `csvCache.mjs`: split download (`getSourceFile`) from parsing; `pickFileFromZip` also accepts `.xlsx`/`.xls`; route Excel bytes (magic bytes or extension) to `readExcelTable`, CSV/TSV to the existing parser; remove the XLSX rejections. Size check lives in the `/file` route (`bytes.length` vs `Number(process.env.PREVIEW_FILE_MAX_BYTES ?? 4_000_000)`). In `apiHandler.mjs`: add the route, param parsing, error mapping above, and in `run` use the Node engine directly when `isExcelSource(source)` (URL ends `.xlsx`/`.xls`, or `sheet`/`header_row` given). Update the route list comment at the top of the file.
- [ ] **Step 4: Run** `npm test` and `npm run test:functions` — PASS.
- [ ] **Step 5: Commit** (`feat: serve Excel previews and raw source files`).

---

### Task 4: Metadata editor — sheet and header row

**Files:**
- Modify: `web/netlify/functions/_lib/editableFields.mjs`, `web/src/lib/editor/changes.mjs`, `web/src/components/MetadataEditor.astro` (~L89, ~L119)
- Test: `web/netlify/functions/_lib/editableFields.test.mjs`, `web/src/lib/editor/changes.test.mjs`

**Interfaces:**
- Produces: editor payload `download: { url?, sheet?: string|null, header_row?: number|null }`. `null` = clear (auto-detect). `pickEditable` returns `download: { url, sheet: '' , header_row: '' }` when unset (strings for form inputs; numeric sheet → its string).

- [ ] **Step 1: Write failing tests:**
  - `editableFields.test.mjs`: `validateChanges({ download: { sheet: 'Data', header_row: 4 } })` → `{ download: { sheet: 'Data', header_row: 4 } }`; `sheet: '2'` → `2`; `header_row: 0`, `'x'`, `2.5` → 400 field `download.header_row`; `sheet` over 100 chars → 400 `download.sheet`; `''`/`null` → `null`. `download.url` no longer required when absent from the change (still required-if-present). `toTopLevelUpdates` with `{ download: { sheet: null } }` on a current download containing `sheet: 'Data'` → the merged `download` has **no** `sheet` key (deleted, not written as `null`).
  - `changes.test.mjs`: `diffFields` sends only changed `sheet`/`header_row` alongside or without `url`; unchanged → nothing.
- [ ] **Step 2: Run** `npm run test:functions` — FAIL.
- [ ] **Step 3: Implement.** `onlyKeys(value, 'download', ['url', 'sheet', 'header_row'])`. In the editor UI add inputs `download.sheet` ("Excel sheet (name or number)") and `download.header_row` ("Header row (row number in Excel)", `type=number min=1`), help text "Leave blank to detect automatically", shown only while the Download URL field ends in `.xlsx`/`.xls` (toggle on `input`). Empty input → `null` in `edited.download`.
- [ ] **Step 4: Run** `npm run test:functions` — PASS.
- [ ] **Step 5: Commit** (`feat: edit Excel sheet and header row in metadata editor`).

---

### Task 5: Full Excel preview on the Data Preview page

**Files:**
- Modify: `web/src/lib/data/previewSupport.ts`, `web/src/lib/api/backend.ts`, `web/src/pages/data-preview.astro`
- Test: `web/tests/previewSupport.test.ts`

**Interfaces:**
- Consumes: Task 3 routes/params/errors.
- Produces:
  - `backend.ts`: `PreviewParams`, chart params and `fetchFilterOptions` gain `sheet?: string | number; headerRow?: number` (sent as `sheet`, `header_row`); `PreviewResponse.layout?: ExcelLayout` (TS mirror of Task 2's typedef, exported); `ApiError extends Error { status: number; body: Record<string, unknown> }` thrown by `apiFetch` (keep the existing message text); `fetchSourceFile(id) → Promise<{ bytes: Uint8Array; filename: string; format: 'csv'|'tsv'|'xlsx'|'xls'; archive: 'zip' | null }>` throwing `ApiError` (413 carries `body.size`, `body.downloadUrl`).
  - Window event for the notebook: `window.dispatchEvent(new CustomEvent('cdl:excel-layout', { detail: ExcelLayout }))` after every preview load that returns a `layout`. The latest detail is also kept on `window.__cdlExcelLayout` so a notebook opened later can read it.

- [ ] **Step 1: Update tests** in `previewSupport.test.ts`: rename `Excel downloads are info only` → `Excel downloads can be previewed` asserting `null` for `.XLSX` and `.xls#a`.
- [ ] **Step 2: Run** `npm test` — FAIL; then remove the Excel branch from `previewUnavailableReason` (and the Excel sentence in its doc comment) — PASS.
- [ ] **Step 3: backend.ts** — implement the interface additions above.
- [ ] **Step 4: Page — layout bar.** Above the table section add a hidden bar: `<label>Sheet <select id="excel-sheet">`, `<label>Header row <select id="excel-header-row">` (1–20, plus the current value if > 20), and `<p id="excel-layout-note">`. When the preview response has `layout`: show the bar, fill sheets, select current values, note text exactly: `Read from sheet "<sheet>", header on row <n> (<auto-detected | set by curator | your choice>).` — plus ` <k> note rows at the bottom were skipped.` when `trimmedRows > 0`.
- [ ] **Step 5: Page — overrides.** Page state `excelOverride = { sheet, headerRow }` initialised from URL params `sheet` / `header_row`. Changing either select updates state, writes the params into the URL with `history.replaceState`, resets state/county filters, and calls `refreshPreviewAndChart()`. Pass the override to `fetchPreview`, `fetchChart`, `fetchFilterOptions` everywhere they're called (including the initial `limit: 200` sample load). Changing sheet clears the header-row override (new sheet → re-detect).
- [ ] **Step 6: Page — stale link fallback.** If a fetch throws `ApiError` with status 400 and `body.code` in `UNKNOWN_SHEET`/`HEADER_OUT_OF_RANGE`: clear the override and URL params, show in the note `That sheet or header row isn't in this file anymore, so we went back to the default.`, and reload once.
- [ ] **Step 7: Page — events.** Dispatch `cdl:excel-layout` as specified.
- [ ] **Step 8: Verify manually.** Serve fixtures: `npx http-server tests/fixtures -p 4400 --cors` (any static server). Add an **uncommitted** YAML `dev-excel-sample.yml` to `web/backend/data/sources/` (the dir `backend/lib/sourceStore.mjs` reads) with `download.url: http://127.0.0.1:4400/title-rows.xlsx`, then `npm run backend:dev` + `npm run dev`. Open `/web/data-preview?source=dev-excel-sample`: no "Info only" badge, table shows 5 rows with real headers, chart renders, note says "header on row 4 (auto-detected) … 3 note rows …". Change header row to 1 → table re-renders and URL has `header_row=1`. Load `?sheet=Nope` → fallback message. Delete the YAML afterwards.
- [ ] **Step 9: Run** `npm test && npm run lint` — PASS.
- [ ] **Step 10: Commit** (`feat: full Excel preview with sheet and header row selection`).

---

### Task 6: Notebook code generation

**Files:**
- Create: `web/src/components/notebook/codegen.ts`
- Test: `web/tests/notebookCodegen.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type FileFormat = 'csv' | 'tsv' | 'xlsx' | 'xls';
  export interface ReadSpec { format: FileFormat; encoding?: 'utf-8' | 'latin-1';
    sheet?: string | number; headerRow?: number; dataRowCount?: number; trimmedRows?: number }
  export type LoadSource =
    | { kind: 'file'; filename: string }                    // in-browser (Pyodide FS)
    | { kind: 'url'; url: string }                          // export
    | { kind: 'zip'; url: string; innerName: string }       // export
    | { kind: 'upload'; filename: string };                 // export of an uploaded file
  export type Op = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains';
  export interface Condition { column: string; op: Op; value: string; numeric: boolean }
  export type CleaningAction =
    | { kind: 'dropColumns'; columns: string[] }
    | { kind: 'dropRowsByPosition'; start: number; end: number }   // inclusive, 0-based
    | { kind: 'dropRowsWhere'; condition: Condition }
    | { kind: 'dropMissing'; columns: string[]; how: 'any' | 'all' } // [] = all columns
    | { kind: 'fillMissing'; columns: string[]; strategy: 'mean' | 'median' | 'mode' | 'value'; value?: string; numeric?: boolean }
    | { kind: 'rename'; from: string; to: string }
    | { kind: 'changeType'; column: string; to: 'number' | 'text' | 'date' }
    | { kind: 'filterRows'; condition: Condition }
    | { kind: 'dropDuplicates' };
  export function pyStr(s: string): string;            // Python double-quoted literal
  export function loadCell(source: LoadSource, read: ReadSpec): string;
  export function actionCell(action: CleaningAction): string;
  export function toIpynb(cells: string[]): string;      // nbformat 4.5 JSON, 1-space indent
  ```

- [ ] **Step 1: Write failing tests** — exact strings (these fix the copy):
  - `pyStr`: `pyStr('a "b"\\c\n') === '"a \\"b\\"\\\\c\\n"'`; non-ASCII passes through unchanged.
  - CSV in-browser:
    ```python
    # Load the dataset into a table called df
    import pandas as pd

    df = pd.read_csv("co-est2025-alldata.csv")
    ```
    latin-1 adds `, encoding="latin-1"`; tsv adds `, sep="\t"` (written as the two characters `\t`).
  - Excel with `{ sheet: 'Data', headerRow: 4, dataRowCount: 52, trimmedRows: 3 }`:
    ```python
    # Load the dataset into a table called df
    import pandas as pd

    # Read the "Data" sheet. The column names are on row 4, so skip the 3 rows above them.
    # nrows=52 stops before the notes at the bottom of the sheet.
    df = pd.read_excel("file.xlsx", sheet_name="Data", skiprows=3, nrows=52)
    ```
    `headerRow: 1` → comment `# Read the "Data" sheet.` and no `skiprows`; `trimmedRows: 0` → no `nrows` line or argument; numeric sheet → `sheet_name=1`.
  - Export `url`:
    ```python
    # Load the dataset into a table called df
    import pandas as pd

    url = "https://www2.census.gov/x.csv"
    # Some data providers block Python's default User-Agent, so identify as a browser.
    df = pd.read_csv(url, storage_options={"User-Agent": "Mozilla/5.0"})
    ```
  - Export `zip`:
    ```python
    # Load the dataset into a table called df
    import io
    import urllib.request
    import zipfile

    import pandas as pd

    url = "https://x.gov/a.zip"
    # Download the zip file, then open the data file inside it.
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request) as response:
        archive = zipfile.ZipFile(io.BytesIO(response.read()))
    df = pd.read_csv(archive.open("inner.csv"))
    ```
  - Export `upload`: line 2 is `# Put "my-data.csv" in the same folder as this notebook (in Colab, upload it with the Files panel).`, then `import pandas as pd`, blank, `df = pd.read_csv("my-data.csv")`.
  - Actions (each is `comment\ncode`):
    - dropColumns `['SUMLEV','REGION']` → `# Drop columns we don't need` / `df = df.drop(columns=["SUMLEV", "REGION"])`
    - dropRowsByPosition 10–20 → `# Drop rows 10 through 20 (counting from 0)` / `df = df.drop(df.index[10:21])`
    - dropRowsWhere AGE > 65 numeric → `# Drop rows where AGE > 65` / `df = df[~(df["AGE"] > 65)]`
    - dropMissing `[]`/any → `# Drop rows that have any missing values` / `df = df.dropna()`; `[]`/all → `# Drop rows where every value is missing` / `df = df.dropna(how="all")`; `['POP']` (either `how`) → `# Drop rows where POP is missing` / `df = df.dropna(subset=["POP"])`; `['POP','AGE']`/any → `# Drop rows where any of POP, AGE is missing` / `df = df.dropna(subset=["POP", "AGE"])`; `['POP','AGE']`/all → `# Drop rows where all of POP, AGE are missing` / `df = df.dropna(subset=["POP", "AGE"], how="all")`.
    - fillMissing median one column → `# Fill missing values in POPESTIMATE2020 with the column's median` / `df["POPESTIMATE2020"] = df["POPESTIMATE2020"].fillna(df["POPESTIMATE2020"].median())`; mode uses `.mode()[0]`; value numeric `0` → `.fillna(0)`; value text → `.fillna("Unknown")`; two columns → one comment `# Fill missing values in A, B with each column's mean` and one line per column.
    - rename → `# Rename column STNAME to state` / `df = df.rename(columns={"STNAME": "state"})`
    - changeType number → `# Convert AGE to numbers (values that aren't numbers become missing)` / `df["AGE"] = pd.to_numeric(df["AGE"], errors="coerce")`; text → `# Convert AGE to text` / `df["AGE"] = df["AGE"].astype("string")`; date → `# Convert DATE to dates (values that aren't dates become missing)` / `df["DATE"] = pd.to_datetime(df["DATE"], errors="coerce")`
    - filterRows STNAME == Tennessee text → `# Keep only rows where STNAME == "Tennessee"` / `df = df[df["STNAME"] == "Tennessee"]`; contains → `df = df[df["X"].astype("string").str.contains("abc", na=False)]` with comment `# Keep only rows where X contains "abc"`.
    - dropDuplicates → `# Remove duplicate rows` / `df = df.drop_duplicates()`
  - Column names with quotes/spaces go through `pyStr` (one test with `Pop "2020" est`).
  - `toIpynb(['a = 1', 'b'])` → parses as JSON; `nbformat === 4`, `nbformat_minor === 5`; two `code` cells with `source` split into lines keeping `\n`; `outputs: []`, `execution_count: null`; `metadata.kernelspec.name === 'python3'`; each cell has a string `id`.
- [ ] **Step 2: Run** `npm test` — FAIL.
- [ ] **Step 3: Implement** `codegen.ts`. Numeric condition values are emitted verbatim only if they parse as finite numbers, else as `pyStr`.
- [ ] **Step 4: Run** `npm test` — PASS.
- [ ] **Step 5: Commit** (`feat: add notebook code generation`).

---

### Task 7: Notebook persistence and cell-list helpers

**Files:**
- Create: `web/src/components/notebook/notebookStore.ts`
- Test: `web/tests/notebookStore.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface CellState { id: string; code: string; status: 'idle'|'running'|'ok'|'error'|'stale'; output?: CellOutput }
  export type CellOutput = { stdout: string; error?: { name: string; message: string; traceback: string }; table?: { columns: string[]; rows: string[][] }; text?: string };
  export function storageKey(sourceId: string): string;           // `cdl-notebook:v1:${sourceId}`
  export function loadSavedCode(sourceId: string): string[] | null; // cells AFTER the load cell
  export function saveCode(sourceId: string, cells: CellState[]): void; // saves cells[1..].code
  export function clearSaved(sourceId: string): void;
  export function restoreCells(loadCode: string, saved: string[] | null): CellState[]; // load cell + saved, all 'idle'
  export function markStaleFrom(cells: CellState[], index: number): CellState[]; // cells after index that ran → 'stale'
  export function newCell(code?: string): CellState;
  ```
- [ ] **Step 1: Write failing tests:** `restore replaces the load cell` (saved array never contains the load cell; `restoreCells('NEW', ['x'])[0].code === 'NEW'`); `save/load round-trip`; `storage that throws returns null and does not throw` (stub `globalThis.localStorage` whose methods throw); `markStaleFrom only marks cells that already ran`.
- [ ] **Step 2: Run** `npm test` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** (`feat: add notebook persistence helpers`).

---

### Task 8: Pyodide worker, Python helpers, `usePyodide` hook

**Files:**
- Create: `web/src/components/notebook/helpers.py`, `pyodideWorker.ts`, `usePyodide.ts`
- Test: `web/tests/notebook_helpers_test.py`

**Interfaces:**
- `helpers.py` (module `cdl_helpers`, written into Pyodide FS and imported):
  - `run_cell(code: str, ns: dict) -> dict` — runs with stdout captured; if the last statement is an expression, evaluates it: DataFrame/Series → `{"table": {"columns", "rows"}}` (first 50 rows, values `str()`, NaN → `""`), other non-None → `{"text": repr}`. Errors → `{"error": {"name", "message", "traceback"}}` with the traceback trimmed to frames from the cell. Always includes `"stdout"`.
  - `df_info(ns: dict) -> dict | None` — `None` if `ns.get("df")` isn't a DataFrame; else `{"rows", "cols", "columns": [{"name", "dtype", "numeric", "missing"}], "head": {"columns", "rows"}}` (head = 50 rows).
  - `export_df(ns: dict, fmt: str) -> bytes` — `csv` via `to_csv(index=False)` UTF-8; `xlsx` via `to_excel(index=False)` (openpyxl) into BytesIO.
- Worker messages (`postMessage`, all with optional `id` for request/response pairing):
  - in `{type:'init'}` → out `{type:'status', text}` (`Loading Python…`, `Loading pandas…`) then `{type:'ready'}` or `{type:'fatal', message}`
  - in `{type:'writeFile', id, name, bytes}` → `{type:'done', id}`; if `name` ends `.xls`, worker first `micropip.install('xlrd')`
  - in `{type:'run', id, code}` → `{type:'result', id, output: CellOutput, dfInfo: DfInfo | null}`
  - in `{type:'export', id, format:'csv'|'xlsx'}` → `{type:'file', id, bytes}` (transferable) or `{type:'result', id, output:{error…}}`
- Types (exported from `usePyodide.ts`): `DfColumn { name: string; dtype: string; numeric: boolean; missing: number }`, `DfInfo { rows: number; cols: number; columns: DfColumn[]; head: { columns: string[]; rows: string[][] } }`; `CellOutput` is imported from `notebookStore.ts` (Task 7).
- `usePyodide()` → `{ state: 'idle'|'loading'|'ready'|'error', status: string, start(): void, writeFile(name, bytes): Promise<void>, run(code): Promise<{ output: CellOutput; dfInfo: DfInfo | null }>, exportDf(fmt): Promise<Uint8Array>, restart(): Promise<void> }`. `restart` terminates the worker, rejects all pending promises with `Error('Stopped')`, and re-inits.
- Packages: `loadPackage(['pandas', 'micropip'])`, then `micropip.install('openpyxl')`. Worker created with `new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' })`; Pyodide via `await import('https://cdn.jsdelivr.net/pyodide/v0.27.2/full/pyodide.mjs')`.

- [ ] **Step 1: Write failing Python tests** `tests/notebook_helpers_test.py` (run with CPython + pandas + openpyxl, same environment as the local pandas preview engine; load `helpers.py` via `importlib.util.spec_from_file_location`):
  - `test_last_expression_dataframe_returns_table`, `test_print_is_captured`, `test_error_has_name_message_and_cell_traceback` (`KeyError` from `df["nope"]`; traceback has no frames from `cdl_helpers`), `test_df_info_counts_missing_and_numeric`, `test_df_info_none_without_df`, `test_export_csv_and_xlsx_round_trip`.
  - `test_pandas_matches_js_loader_on_fixtures`: for each entry in `tests/fixtures/expected.json`, `pd.read_excel(path, sheet_name=sheet, skiprows=headerRow-1 or None, nrows=dataRowCount if trimmedRows else None)` → `list(df.columns) == headers` and `len(df) == rowCount` (`.xls` needs `xlrd`; skip with a message if not installed). **If this fails, fix `excelLayout.mjs` (Task 2) so the JS loader matches pandas, not the other way round.**
- [ ] **Step 2: Run** `python3 -m unittest tests/notebook_helpers_test.py` — FAIL. **Step 3: Implement** `helpers.py`. **Step 4: Run** — PASS.
- [ ] **Step 5: Implement** `pyodideWorker.ts` and `usePyodide.ts` per the protocol (import `helpers.py?raw`).
- [ ] **Step 6: Run** `npm run build` — PASS (worker and `?raw` import bundle).
- [ ] **Step 7: Commit** (`feat: add Pyodide worker and notebook Python helpers`).

---

### Task 9: Notebook UI — load, cells, data view, upload, persistence, Stop

**Files:**
- Create: `web/src/components/notebook/Notebook.tsx`, `Cell.tsx`, `DataView.tsx`, `UploadZone.tsx`, `notebook.css`
- Modify: `web/package.json` (`codemirror`, `@codemirror/lang-python`), `web/src/pages/data-preview.astro` (mount)

**Interfaces:**
- Consumes: `fetchSourceFile`, `ApiError`, `ExcelLayout`, `cdl:excel-layout` (Task 5); `readExcelTable` (Task 2); `loadCell`, `pyStr` (Task 6); `notebookStore` (Task 7); `usePyodide` (Task 8).
- Produces: `Notebook` default export with **no props**, mounted in `data-preview.astro` as `<Notebook client:only="react" />` inside `#preview-content`. The page resolves the source at runtime, so the component reads `source` from `location.search` and calls `fetchSource(id)` itself for `download.url` and info-only status (`previewUnavailableReason`).

**Behaviour (decided):**
- Section title `Clean this data` at the bottom of `#preview-content`, collapsed, with button `Open notebook` and one line: `Write and run Python (pandas) right here. The first time takes a few seconds to load.` Hidden for info-only sources.
- On open: `start()`, show status text; then `fetchSourceFile` → detect CSV encoding in the browser (`TextDecoder('utf-8', { fatal: true })` succeeds → utf-8, else latin-1) → `writeFile(filename, bytes)` → build load cell with `loadCell({kind:'file', filename}, readSpec)` where Excel `readSpec` comes from `window.__cdlExcelLayout` (catalog file) → `restoreCells(load, loadSavedCode(id))` → run the load cell only, then show `Run all` hint if more cells were restored.
- `ApiError` 413: message `This file is too large to open automatically. Download it with the button above, then use "Use my own file".`; other errors: `Couldn't load the dataset: <message>`; both show `UploadZone`.
- `UploadZone`: always available via `Use my own file` button; accepts `.csv,.tsv,.txt,.xlsx,.xls`; Excel uploads run `readExcelTable` in the browser for layout and show their own Sheet/Header row selects inside the notebook which regenerate the load cell. Uploading replaces the load cell; later cells are kept and marked stale.
- `cdl:excel-layout` while open: if code differs, show inline prompt `The preview's sheet or header row changed. Reload data and re-run all steps?` [Reload] [Keep current] → Reload regenerates the load cell and runs all.
- Cells: CodeMirror editor; `Shift+Enter` runs; Run / Move up / Move down / Delete (load cell can't be deleted or moved); output shows stdout, table, text, or error (`<name>: <message>` bold, traceback in `<details>`). Editing or running cell *i* marks later ran cells stale (`markStaleFrom`). Toolbar: `Run all`, `+ Code cell`, `+ Cleaning step ▾` (Task 10 slot), `Export ▾` (Task 11 slot), `Stop`, `Reset` (`clearSaved` + regenerate). Save code with `saveCode` after every change (debounced 500 ms).
- `Stop`: `restart()` → rewrite the current file → all cells `stale` → status `Python restarted. Run the cells again to rebuild df.`
- `DataView`: from latest `dfInfo`: `<rows> rows × <cols> columns`, a row of `missing: n` per column, then the head table in a horizontally scrolling container; `df isn't a table right now.` when null.
- Layout: single column on narrow screens; no page-level horizontal scroll; reuse page tokens/classes (`section-title`, `btn-download`).

- [ ] **Step 1: Add deps** `npm i codemirror @codemirror/lang-python`.
- [ ] **Step 2: Implement** components per the behaviour above; mount in the page.
- [ ] **Step 3: Run** `npm run lint && npm test && npm run build` — PASS; confirm in build output that Pyodide is not fetched on page load (no `pyodide` request in the Network tab until the button is clicked).
- [ ] **Step 4: Verify manually** (backend + dev server running, CSV source `census-state-pop-change-2020-2025`): open notebook → load cell runs, data view shows rows × cols; add a code cell `df.head()` → table output; `df["nope"]` → `KeyError` shown; edit cell 1 → cell 2 marked stale; reload page and reopen → cells restored, load cell regenerated; `Stop` during `while True: pass` → restart message, cells stale, `Run all` works again; upload `tests/fixtures/notes-first.xlsx` → sheet select shows Notes/Data, `Data` chosen.
- [ ] **Step 5: Commit** (`feat: add in-browser data cleaning notebook`).

---

### Task 10: Guided cleaning actions menu

**Files:**
- Create: `web/src/components/notebook/ActionMenu.tsx`
- Modify: `web/src/components/notebook/Notebook.tsx`

**Interfaces:**
- Consumes: `CleaningAction`, `actionCell` (Task 6); `DfInfo` (Task 8).
- Produces: `<ActionMenu columns={DfInfo['columns']} disabled={boolean} onInsert={(code: string) => void} />`. Notebook inserts the cell after the selected cell (or at the end) and runs it.

**Behaviour (decided):** `+ Cleaning step ▾` lists, in order: Drop columns · Drop rows by position · Drop rows where… · Drop missing values · Fill missing values · Rename a column · Change a column's type · Keep only rows where… · Remove duplicate rows. Each opens an inline form with real `<label>`s; column pickers come from `columns` (multi-select = checkbox list); fill strategies `mean`/`median` are only offered when every chosen column is numeric; condition `value` field sets `numeric` from the column's `numeric` flag; `Add step` is disabled until the form is valid; `Esc` closes. Menu disabled with tooltip `Load the data first` when `dfInfo` is null.

- [ ] **Step 1: Implement** `ActionMenu.tsx` and wire it into `Notebook.tsx`.
- [ ] **Step 2: Run** `npm run lint && npm run build` — PASS.
- [ ] **Step 3: Verify manually** on `census-county-estimates-all-2025`: run every action once; each inserts the exact Task 6 code, runs, and the data view updates (e.g. drop `SUMLEV` → column gone; keep `STNAME == "Tennessee"` → row count drops; fill median offered only for numeric columns). Keyboard-only pass through one form.
- [ ] **Step 4: Commit** (`feat: add guided cleaning actions`).

---

### Task 11: Export menu and end-to-end check

**Files:**
- Create: `web/src/components/notebook/ExportMenu.tsx`
- Modify: `web/src/components/notebook/Notebook.tsx`

**Interfaces:**
- Consumes: `exportDf` (Task 8); `toIpynb`, `loadCell` (Task 6); file metadata from `fetchSourceFile` (`archive`, `filename`, `format`) and `downloadUrl`.
- Produces: `<ExportMenu sourceId cells loadSource readSpec disabled />`.

**Behaviour (decided):** `Export ▾` → `Cleaned data (CSV)`, `Cleaned data (Excel)`, `Notebook (.ipynb)`. Data exports call `exportDf` and download via a Blob + temporary `<a download>`; errors show inline. `.ipynb` replaces cell 0 with `loadCell(exportSource, readSpec)` where `exportSource` is `{kind:'zip', url, innerName: filename}` if `archive === 'zip'`, `{kind:'upload', filename}` for uploads, else `{kind:'url', url: downloadUrl}`; other cells unchanged.

- [ ] **Step 1: Implement** and wire in.
- [ ] **Step 2: Run** full suites: web `npm run lint && npm test && npm run test:functions && npm run build`; backend `python3 -m unittest discover pythonscripts/tests` — all PASS.
- [ ] **Step 3: Verify end to end** on a CSV source and the Task 5 dev Excel source: apply 3 actions, export CSV + Excel (open both; shapes match the data view), export `.ipynb` and run it in local Jupyter (`pip install notebook pandas openpyxl`) or Colab — it loads from the original URL and reproduces the same `df.shape`. Phone-width check (375 px): no horizontal page scroll.
- [ ] **Step 4: Commit** (`feat: export cleaned data and notebooks`).
