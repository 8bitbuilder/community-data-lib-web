import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  audienceNote,
  chooseSlice,
  communityCounty,
  countyFileUrl,
  defaultXVariable,
  meanByGroup,
  pickFocalVariable,
  previewFileUrl,
  rowsMeta,
  scatterPoints,
  tableColumns,
  xVariableOptions,
  type PreviewVariable,
} from '../src/lib/data/staticPreview.ts';

const knox = { name: 'Knox County Data Library', county_fips: '47093', label: 'Knox County, TN' };
const communities = { 'knox-county': knox };

test('preview file URLs live under the base path and are encoded', () => {
  assert.equal(previewFileUrl('/web/previews/', 'chr-analytic-data-2025', 'sample.json'), '/web/previews/chr-analytic-data-2025/sample.json');
  assert.equal(countyFileUrl('/web/previews', 'a b', '47093'), '/web/previews/a%20b/county/47093.json');
});

test('?community=<slug> resolves to that library\'s county', () => {
  assert.equal(communityCounty('knox-county', communities), knox);
  assert.equal(communityCounty('nowhere', communities), null);
  assert.equal(communityCounty('constructor', communities), null);
  assert.equal(communityCounty(null, communities), null);
});

test('chooseSlice uses the county file when the dataset has one, and explains when not', () => {
  const byCounty = { rows: 10, county: { method: 'fips_column', columns: ['FIPS'], counties: ['47037', '47093'], truncated: [] } };
  assert.deepEqual(chooseSlice(byCounty, { fips: '47093', label: 'Knox County, TN' }), {
    kind: 'county',
    fips: '47093',
    note: 'Showing the rows for Knox County, TN.',
  });
  assert.match((chooseSlice(byCounty, { fips: '01001', label: 'Autauga County, AL' }) as { note: string }).note, /no rows for Autauga/);
  assert.match((chooseSlice({ rows: 5, county: null }, { fips: '47093', label: 'Knox County, TN' }) as { note: string }).note, /isn't broken down by county/);
  assert.deepEqual(chooseSlice(byCounty, null), { kind: 'sample', note: null });
});

test('rowsMeta reports truncated county slices honestly', () => {
  assert.equal(rowsMeta({ rows: [], rows_included: 41, rows_total: 3204 }, 41, 'the dataset'), 'Showing 41 of 41 rows (3,204 in the dataset; the preview file holds the first 41)');
  assert.equal(rowsMeta({ rows: [], rows_included: 1, rows_total: 1 }, 1, 'Knox County, TN'), 'Showing 1 of 1 rows in Knox County, TN');
});

const variables: PreviewVariable[] = [
  { name: 'Name', type: 'text' },
  { name: 'Year', type: 'number' },
  { name: 'Premature Death raw value', code: 'v001_rawvalue', type: 'number' },
  { name: 'Notes', type: 'empty' },
];

test('focal and X variables', () => {
  assert.equal(pickFocalVariable(variables), 'Premature Death raw value');
  assert.equal(pickFocalVariable([{ name: 'A', type: 'text' }]), '');
  assert.deepEqual(xVariableOptions(variables, 'bar'), ['Name', 'Year', 'Premature Death raw value']);
  assert.deepEqual(xVariableOptions(variables, 'scatter'), ['Year', 'Premature Death raw value']);
  assert.equal(defaultXVariable(variables, 'bar'), 'Year');
  assert.equal(defaultXVariable([{ name: '1. YEAR', type: 'number' }, { name: 'X', type: 'text' }], 'bar'), '1. YEAR');
});

test('bar and line charts average Y per X value', () => {
  const rows = [
    ['Knox', '2020', '10'],
    ['Knox', '2021', '20'],
    ['Davidson', '2020', '30'],
    ['Davidson', '2021', ''],
    ['', '2021', '5'],
  ];
  assert.deepEqual(meanByGroup(rows, 0, 2), [
    { label: 'Knox', value: 15 },
    { label: 'Davidson', value: 30 },
  ]);
  // Numeric X values are sorted.
  assert.deepEqual(meanByGroup([['2021', '1'], ['2020', '3'], ['2020', '5']], 0, 1), [
    { label: '2020', value: 4 },
    { label: '2021', value: 1 },
  ]);
  assert.equal(meanByGroup(Array.from({ length: 40 }, (_, i) => [`g${i}`, '1']), 0, 1).length, 15);
});

test('scatter keeps numeric pairs only, up to the limit', () => {
  assert.deepEqual(scatterPoints([['1', '2'], ['x', '3'], ['1,000', '4']], 0, 1), [[1, 2], [1000, 4]]);
  assert.equal(scatterPoints(Array.from({ length: 500 }, () => ['1', '1']), 0, 1).length, 300);
});

test('wide tables show the first columns plus the charted ones', () => {
  assert.deepEqual(tableColumns(3, [2]), [0, 1, 2]);
  assert.deepEqual(tableColumns(100, [75, 3, 200], 4), [0, 1, 2, 3, 75]);
});

test('the audience note is read from the browser URL', () => {
  assert.equal(audienceNote('?source=x&audience=teacher'), 'Opened from the Teacher catalog view.');
  assert.equal(audienceNote('?audience=community_member'), 'Opened from the Community Member catalog view.');
  assert.equal(audienceNote('?audience=admin'), null);
  assert.equal(audienceNote(''), null);
});
