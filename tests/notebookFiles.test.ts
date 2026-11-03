import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectEncoding,
  errorMessage,
  isExcel,
  loadCodeFor,
  readSpecFor,
  textFormat,
  uploadKind,
  UPLOAD_ACCEPT,
} from '../src/components/notebook/notebookFiles.ts';
import type { ExcelLayout } from '../src/lib/api/backend.ts';

const enc = (s: string) => new TextEncoder().encode(s);

const layout: ExcelLayout = {
  format: 'xlsx',
  sheets: ['Notes', 'Data'],
  sheet: 'Data',
  headerRow: 4,
  dataRowCount: 52,
  trimmedRows: 3,
  origin: { sheet: 'auto', headerRow: 'auto' },
};

test('detectEncoding: valid UTF-8 (incl. multibyte) is utf-8', () => {
  assert.equal(detectEncoding(enc('name,city\nJosé,Knoxville\n')), 'utf-8');
  assert.equal(detectEncoding(new Uint8Array()), 'utf-8');
});

test('detectEncoding: invalid UTF-8 bytes are latin-1', () => {
  // "José" in latin-1: 0xE9 alone is not valid UTF-8.
  assert.equal(detectEncoding(new Uint8Array([0x4a, 0x6f, 0x73, 0xe9, 0x0a])), 'latin-1');
});

test('textFormat: by extension, sniffing .txt', () => {
  assert.equal(textFormat('a.csv', enc('a\tb\n')), 'csv');
  assert.equal(textFormat('a.TSV', enc('a,b\n')), 'tsv');
  assert.equal(textFormat('a.txt', enc('a\tb\tc\n1\t2\t3\n')), 'tsv');
  assert.equal(textFormat('a.txt', enc('a,b\tc\n')), 'csv');
  assert.equal(textFormat('a.txt', enc('a,b\n')), 'csv');
});

test('uploadKind: supported and unsupported extensions', () => {
  assert.equal(uploadKind('Data.XLSX'), 'excel');
  assert.equal(uploadKind('old.xls'), 'excel');
  assert.equal(uploadKind('x.csv'), 'text');
  assert.equal(uploadKind('x.tsv'), 'text');
  assert.equal(uploadKind('x.txt'), 'text');
  assert.equal(uploadKind('report.pdf'), null);
  assert.equal(uploadKind('noext'), null);
  assert.equal(UPLOAD_ACCEPT, '.csv,.tsv,.txt,.xlsx,.xls');
});

test('isExcel', () => {
  assert.equal(isExcel('xlsx'), true);
  assert.equal(isExcel('xls'), true);
  assert.equal(isExcel('csv'), false);
  assert.equal(isExcel('tsv'), false);
});

test('readSpecFor: CSV keeps format and encoding', () => {
  assert.deepEqual(readSpecFor({ format: 'csv', encoding: 'latin-1' }), { format: 'csv', encoding: 'latin-1' });
});

test('readSpecFor: Excel uses the layout region', () => {
  assert.deepEqual(readSpecFor({ format: 'xlsx', layout }), {
    format: 'xlsx',
    sheet: 'Data',
    headerRow: 4,
    dataRowCount: 52,
    trimmedRows: 3,
  });
});

test('loadCodeFor: CSV with latin-1', () => {
  const code = loadCodeFor({ filename: 'pop.csv', format: 'csv', encoding: 'latin-1' });
  assert.match(code, /df = pd\.read_csv\("pop\.csv", encoding="latin-1"\)$/);
});

test('loadCodeFor: Excel reads the layout sheet with skiprows/nrows', () => {
  const code = loadCodeFor({ filename: 'f.xlsx', format: 'xlsx', layout });
  assert.match(code, /pd\.read_excel\("f\.xlsx", sheet_name="Data", skiprows=3, nrows=52\)/);
  assert.match(code, /df\.columns = df\.columns\.astype\(str\)$/);
});

test('errorMessage', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('plain'), 'plain');
});
