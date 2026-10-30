import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  readExcelTable,
  detectHeaderRow,
  findDataEnd,
  LayoutError,
} from '../src/lib/data/excelLayout.mjs';

const fx = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('clean sheet: header row 1, all rows', () => {
  const { headers, rows, layout } = readExcelTable(fx('clean.xlsx'));
  assert.deepEqual(headers, ['Name', 'Count', 'Share']);
  assert.equal(rows.length, 3);
  assert.deepEqual(layout.origin, { sheet: 'auto', headerRow: 'auto' });
  assert.equal(layout.trimmedRows, 0);
  assert.equal(layout.format, 'xlsx');
});

test('title rows are skipped and footnotes trimmed', () => {
  const { rows, layout } = readExcelTable(fx('title-rows.xlsx'));
  assert.equal(layout.headerRow, 4);
  assert.equal(rows.length, 5);
  assert.equal(layout.dataRowCount, 5);
  assert.equal(layout.trimmedRows, 3);
  assert.ok(!rows.some((r: string[]) => r.some((c) => c.includes('Source:'))));
});

test('auto picks the data sheet over a notes sheet', () => {
  const { layout } = readExcelTable(fx('notes-first.xlsx'));
  assert.equal(layout.sheet, 'Data');
  assert.deepEqual(layout.sheets, ['Notes', 'Data']);
});

test('curator default beats auto, visitor beats curator', () => {
  const c = readExcelTable(fx('notes-first.xlsx'), { curator: { sheet: 'Notes' } });
  assert.equal(c.layout.sheet, 'Notes');
  assert.equal(c.layout.origin.sheet, 'curator');
  const v = readExcelTable(fx('notes-first.xlsx'), {
    curator: { sheet: 'Notes' },
    visitor: { sheet: 'Data', headerRow: 1 },
  });
  assert.equal(v.layout.origin.sheet, 'visitor');
  assert.equal(v.layout.origin.headerRow, 'visitor');
});

test('sheet may be a 0-based index', () => {
  const { layout } = readExcelTable(fx('notes-first.xlsx'), { visitor: { sheet: 1 } });
  assert.equal(layout.sheet, 'Data');
});

test('pandas-compatible names for blank and duplicate headers', () => {
  const { headers } = readExcelTable(fx('blank-dup-headers.xlsx'));
  assert.deepEqual(headers, ['State', 'Unnamed: 1', 'Pop', 'Pop.1']);
});

test('unknown sheet and out-of-range header row throw LayoutError', () => {
  assert.throws(
    () => readExcelTable(fx('clean.xlsx'), { visitor: { sheet: 'Nope' } }),
    (e: any) => e instanceof LayoutError && e.code === 'UNKNOWN_SHEET' && e.sheets.includes('Sheet1'),
  );
  assert.throws(
    () => readExcelTable(fx('clean.xlsx'), { visitor: { headerRow: 99 } }),
    (e: any) => e instanceof LayoutError && e.code === 'HEADER_OUT_OF_RANGE',
  );
});

test('empty sheet throws NoDataError', () => {
  assert.throws(
    () => readExcelTable(fx('empty.xlsx')),
    (e: any) => e instanceof LayoutError && e.code === 'NO_DATA',
  );
});

test('xls files are read', () => {
  const { headers, layout } = readExcelTable(fx('legacy.xls'));
  assert.equal(layout.format, 'xls');
  assert.deepEqual(headers, readExcelTable(fx('clean.xlsx')).headers);
});

test('detectHeaderRow handles title rows, year labels and numeric rows', () => {
  assert.equal(
    detectHeaderRow([['Table 1', '', ''], ['', '', ''], ['Area', '2020', '2021'], ['Knox', '1', '2']]),
    3,
  );
  assert.equal(detectHeaderRow([['Area', 'Pop'], ['5', '6'], ['7', '8']]), 1);
  assert.notEqual(
    detectHeaderRow([['Table', '', ''], ['Area', '12.5', '99'], ['Knox', 'x', 'y'], ['a', 'b', 'c']]),
    2,
  );
});

test('findDataEnd stops at footnotes and double blank rows', () => {
  const g1 = [['A', 'B', 'C'], ['1', '2', '3'], ['4', '5', '6'], ['Source: Census', '', '']];
  assert.equal(findDataEnd(g1, 0), 3);
  const g2 = [['A', 'B'], ['1', '2'], ['', ''], ['', ''], ['x', 'y']];
  assert.equal(findDataEnd(g2, 0), 2);
  const g3 = [['A', 'B'], ['1', '2'], ['', '']];
  assert.equal(findDataEnd(g3, 0), 2);
});
