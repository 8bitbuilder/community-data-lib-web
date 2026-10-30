import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EXPORT_MIME,
  exportFilename,
  exportSourceFor,
  notebookCellsFor,
  notebookJson,
} from '../src/components/notebook/exportPlan.ts';

const URL_ = 'https://example.org/data.csv';

test('exportSourceFor: zip archive uses the zip form with the inner file name', () => {
  assert.deepEqual(exportSourceFor({ origin: 'catalog', filename: 'a.csv', archive: 'zip' }, URL_), {
    kind: 'zip',
    url: URL_,
    innerName: 'a.csv',
  });
});

test('exportSourceFor: uploads use the upload form even when a URL exists', () => {
  assert.deepEqual(exportSourceFor({ origin: 'upload', filename: 'mine.csv', archive: null }, URL_), {
    kind: 'upload',
    filename: 'mine.csv',
  });
});

test('exportSourceFor: plain catalog file uses the url form', () => {
  assert.deepEqual(exportSourceFor({ origin: 'catalog', filename: 'a.csv', archive: null }, URL_), {
    kind: 'url',
    url: URL_,
  });
});

test('exportSourceFor: no download URL falls back to upload form', () => {
  for (const u of [undefined, '']) {
    assert.deepEqual(exportSourceFor({ origin: 'catalog', filename: 'a.csv', archive: null }, u), {
      kind: 'upload',
      filename: 'a.csv',
    });
    assert.deepEqual(exportSourceFor({ origin: 'catalog', filename: 'a.zip.csv', archive: 'zip' }, u), {
      kind: 'upload',
      filename: 'a.zip.csv',
    });
  }
});

test('notebookCellsFor replaces cell 0 and keeps the rest', () => {
  const cells = notebookCellsFor(
    ['in-browser load', 'df = df.dropna()', '# note'],
    { kind: 'url', url: URL_ },
    { format: 'csv', encoding: 'utf-8' },
  );
  assert.equal(cells.length, 3);
  assert.notEqual(cells[0], 'in-browser load');
  assert.ok(cells[0].includes(URL_));
  assert.deepEqual(cells.slice(1), ['df = df.dropna()', '# note']);
});

test('notebookCellsFor passes the Excel ReadSpec through to the load cell', () => {
  const [load] = notebookCellsFor(
    ['x'],
    { kind: 'url', url: 'https://example.org/t.xlsx' },
    { format: 'xlsx', sheet: 'Data', headerRow: 3, dataRowCount: 10 },
  );
  assert.ok(load.includes('Data'));
  assert.ok(load.includes('df.columns = df.columns.astype(str)'));
});

test('notebookJson is code-only nbformat with no outputs', () => {
  const nb = JSON.parse(notebookJson(['a = 1', 'b = 2'], { kind: 'url', url: URL_ }, { format: 'csv' }));
  assert.equal(nb.cells.length, 2);
  assert.ok(nb.cells.every((c: { cell_type: string; outputs: unknown[] }) => c.cell_type === 'code' && c.outputs.length === 0));
  assert.equal(nb.cells[1].source.join(''), 'b = 2');
});

test('exportFilename and MIME types', () => {
  assert.equal(exportFilename('csv', 'census-state-pop'), 'census-state-pop-cleaned.csv');
  assert.equal(exportFilename('xlsx', 'census-state-pop'), 'census-state-pop-cleaned.xlsx');
  assert.equal(exportFilename('ipynb', 'census-state-pop'), 'census-state-pop-notebook.ipynb');
  assert.equal(exportFilename('ipynb', 'we/ird id'), 'we-ird-id-notebook.ipynb');
  assert.equal(exportFilename('csv', 'we/ird id'), 'we-ird-id-cleaned.csv');
  assert.equal(EXPORT_MIME.csv, 'text/csv');
  assert.equal(EXPORT_MIME.xlsx, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(EXPORT_MIME.ipynb, 'application/x-ipynb+json');
});
