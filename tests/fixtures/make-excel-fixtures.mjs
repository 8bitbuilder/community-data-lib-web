// Generates Excel fixtures + expected.json (used by the pandas cross-check).
// Run: npm run fixtures:excel
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { readExcelTable } from '../../src/lib/data/excelLayout.mjs';

const dir = dirname(fileURLToPath(import.meta.url));

function book(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  return wb;
}

const cleanAoa = [
  ['Name', 'Count', 'Share'],
  ['Alpha', 10, 0.5],
  ['Beta', 20, 0.25],
  ['Gamma', 30, 0.25],
];

const files = {
  'clean.xlsx': { wb: book([['Sheet1', cleanAoa]]), bookType: 'xlsx' },
  'title-rows.xlsx': {
    bookType: 'xlsx',
    wb: book([
      [
        'Estimates',
        [
          ['Table 1. Population Estimates'],
          ['Prepared for community use'],
          [],
          ['Area', '2020', '2021'],
          ['Knox', 100, 110],
          ['Blount', 200, 210],
          ['Sevier', 300, 310],
          ['Union', 400, 410],
          ['Grainger', 500, 510],
          [],
          ['Source: U.S. Census Bureau'],
          ['1. Estimates are subject to revision.'],
        ],
      ],
    ]),
  },
  'notes-first.xlsx': {
    bookType: 'xlsx',
    wb: book([
      ['Notes', [['About this workbook'], ['The data are on the next sheet. Values are approximate.']]],
      [
        'Data',
        [
          ['County', 'Pop', 'Area'],
          ['Knox', 1, 2],
          ['Blount', 3, 4],
          ['Sevier', 5, 6],
        ],
      ],
    ]),
  },
  'blank-dup-headers.xlsx': {
    bookType: 'xlsx',
    wb: book([
      [
        'Sheet1',
        [
          ['State', '', 'Pop', 'Pop'],
          ['TN', 'a', 1, 2],
          ['KY', 'b', 3, 4],
        ],
      ],
    ]),
  },
  'offset-range.xlsx': {
    bookType: 'xlsx',
    wb: (() => {
      const ws = XLSX.utils.aoa_to_sheet(
        [
          ['Offset table'],
          [],
          ['Area', 'Pop', 'Rate'],
          ['Knox', 1, 2],
          ['Blount', 3, 4],
          ['Sevier', 5, 6],
        ],
        { origin: 'C1' },
      );
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      return wb;
    })(),
  },
  'interior-blank.xlsx': {
    bookType: 'xlsx',
    wb: book([['Sheet1', [['A', 'B'], ['1', '2'], [], ['3', '4'], ['5', '6']]]]),
  },
  'empty.xlsx': { bookType: 'xlsx', wb: book([['Sheet1', []]]) },
  'legacy.xls': { wb: book([['Sheet1', cleanAoa]]), bookType: 'biff8' },
};

const expected = {};
for (const [name, { wb, bookType }] of Object.entries(files)) {
  const bytes = XLSX.write(wb, { type: 'buffer', bookType });
  writeFileSync(join(dir, name), bytes);
  if (name === 'empty.xlsx') continue; // throws NO_DATA by design
  const { headers, rows, layout } = readExcelTable(new Uint8Array(bytes));
  expected[name] = {
    sheet: layout.sheet,
    headerRow: layout.headerRow,
    dataRowCount: layout.dataRowCount,
    headers,
    rowCount: rows.length,
  };
}
writeFileSync(join(dir, 'expected.json'), JSON.stringify(expected, null, 2) + '\n');
console.log('Wrote', Object.keys(files).length, 'fixtures and expected.json');
