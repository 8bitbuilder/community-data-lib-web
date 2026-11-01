import { test } from 'node:test';
import assert from 'node:assert/strict';

import { downloadFileType } from '../src/lib/data/fileType.ts';

test('plain files are labelled by their type', () => {
  assert.deepEqual(downloadFileType('csv'), { label: 'CSV', description: 'A CSV file.', needsConversion: false });
  assert.equal(downloadFileType('xlsx')!.label, 'XLSX');
  assert.equal(downloadFileType('xlsx')!.description, 'An Excel workbook (.xlsx).');
});

test('a zip is labelled with the file inside it', () => {
  assert.deepEqual(downloadFileType('zip/csv'), {
    label: 'ZIP → CSV',
    description: 'A .zip archive containing a CSV file.',
    needsConversion: false,
  });
  assert.equal(downloadFileType('ZIP/XLSX')!.label, 'ZIP → XLSX');
});

test('an Access database needs converting before use', () => {
  const access = downloadFileType('zip/accdb')!;
  assert.equal(access.label, 'ZIP → ACCDB');
  assert.equal(access.description, 'A .zip archive containing a Microsoft Access database (.accdb).');
  assert.equal(access.needsConversion, true);
  assert.equal(downloadFileType('accdb')!.needsConversion, true);
});

test('an unknown type still gets a label', () => {
  assert.deepEqual(downloadFileType('zip/json'), {
    label: 'ZIP → JSON',
    description: 'A .zip archive containing a .json file.',
    needsConversion: false,
  });
});

test('no declared format means no file type', () => {
  assert.equal(downloadFileType(undefined), null);
  assert.equal(downloadFileType(null), null);
  assert.equal(downloadFileType('  '), null);
  assert.equal(downloadFileType('zip/'), null);
});
