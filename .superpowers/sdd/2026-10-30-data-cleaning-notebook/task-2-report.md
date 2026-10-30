# Task 2 report
Built src/lib/data/excelLayout.mjs (readExcelTable, detectHeaderRow, findDataEnd, pandasColumnNames, LayoutError), fixture generator + fixtures + expected.json, tests/excelLayout.test.ts, SheetJS 0.20.3 from cdn.sheetjs.com, script fixtures:excel.
TDD: RED = npm test with module missing -> ERR_MODULE_NOT_FOUND (34 pass / 1 fail). GREEN = 45 pass / 0 fail.
Pandas parity (pandas 3.0.6, throwaway script outside repo): all 4 xlsx fixtures in expected.json give list(df.columns)==headers and len(df)==rowCount with skiprows/nrows as Task 8 specifies. legacy.xls not checked (no xlrd); empty.xlsx omitted from expected.json (throws NO_DATA).
Concerns: sheets whose !ref starts past column A are read from the ref start (pandas/openpyxl may include leading blank columns); numeric-looking header cells in real files become ints in pandas (fixtures use strings). findDataEnd: a single blank row followed by data stays in the region (counts toward dataRowCount).

## Fix round 1
- Grid now anchored at A1 (sheet_to_json `range` from {0,0}), so headerRow/dataRowCount/`Unnamed: i` use Excel's own numbering. New fixture offset-range.xlsx (table at C3, title in C1) -> headers `Unnamed: 0, Unnamed: 1, Area, Pop, Rate`, headerRow 3.
- FINDING: pandas does NOT skip interior blank rows (interior-blank.xlsx: pandas returns 4 rows incl. an all-NaN row, with or without nrows). The brief's "rows exclude blank rows" was wrong, so `rows` now keeps interior blank rows (trailing ones are still trimmed); rowCount == dataRowCount. This deviates from the controller's requested "excluded from rows" in order to keep parity.
- New tests: offset range, curator headerRow, visitor-over-curator headerRow (asserting headers/rows), interior blank row; the notEqual assertion is now exact (3).
- `npm test`: 48 pass / 0 fail. Pandas parity (nrows=dataRowCount, 6 non-xls fixtures incl. offset-range and interior-blank): all True for columns and len.
