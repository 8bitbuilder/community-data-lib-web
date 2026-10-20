import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoundaryIndex,
  countsByCounty,
  coverageLabel,
  datasetsForCounty,
  expandCoverage,
  isNational,
  unknownCoverageFips,
  unmappedDatasets,
  type CoverageDataset,
} from '../src/lib/data/coverageMap.ts';

// A small stand-in for the Census boundary files: two Tennessee counties, one Kentucky county.
const index = buildBoundaryIndex(
  [
    { geoid: '47', name: 'Tennessee', state: 'TN' },
    { geoid: '21', name: 'Kentucky', state: 'KY' },
  ],
  [
    { geoid: '47093', name: 'Knox County', state: 'TN' },
    { geoid: '47037', name: 'Davidson County', state: 'TN' },
    { geoid: '21111', name: 'Jefferson County', state: 'KY' },
  ]
);

const national1: CoverageDataset = { id: 'census-county', title: 'County Estimates', coverage: [{ level: 'nation', geoid: 'US' }] };
const national2: CoverageDataset = { id: 'chr', title: 'County Health Rankings', coverage: [{ level: 'nation', geoid: 'US' }] };
const tennessee: CoverageDataset = { id: 'tri-tn', title: 'TRI Tennessee', coverage: [{ level: 'state', geoid: '47' }] };
const knox: CoverageDataset = { id: 'knox-health', title: 'Knox Health', coverage: [{ level: 'county', geoid: '47093' }] };
const davidson: CoverageDataset = { id: 'nashville-open', title: 'Nashville Open Data', coverage: [{ level: 'county', geoid: '47037' }] };
const unknown: CoverageDataset = { id: 'mystery', title: 'Mystery Data', coverage: [] };

const catalog = [national1, national2, tennessee, knox, davidson, unknown];

test('nation coverage expands to every county', () => {
  assert.deepEqual([...expandCoverage(national1.coverage, index)].sort(), ['21111', '47037', '47093']);
  assert.ok(isNational(national1.coverage));
});

test('state coverage expands to that state only', () => {
  assert.deepEqual([...expandCoverage(tennessee.coverage, index)].sort(), ['47037', '47093']);
  assert.ok(!isNational(tennessee.coverage));
});

test('county coverage covers itself only', () => {
  assert.deepEqual([...expandCoverage(knox.coverage, index)], ['47093']);
});

test('overlapping entries count a dataset once per county', () => {
  const overlapping: CoverageDataset = {
    id: 'overlap',
    title: 'Overlap',
    coverage: [
      { level: 'state', geoid: '47' },
      { level: 'county', geoid: '47093' },
    ],
  };
  assert.equal(countsByCounty([overlapping], index).get('47093'), 1);
});

test('unknown coverage is not counted and is listed as unmapped', () => {
  assert.deepEqual(expandCoverage(unknown.coverage, index).size, 0);
  assert.deepEqual(countsByCounty([unknown], index), new Map([['47093', 0], ['47037', 0], ['21111', 0]]));
  assert.deepEqual(unmappedDatasets(catalog), [unknown]);
  assert.equal(coverageLabel(unknown.coverage, index), 'Coverage unknown');
});

test('Knox County 47093: counts and lists national, statewide and county datasets, most local first', () => {
  const counts = countsByCounty(catalog, index);
  assert.equal(counts.get('47093'), 4);
  assert.equal(counts.get('47037'), 4);
  assert.equal(counts.get('21111'), 2);

  const knoxList = datasetsForCounty('47093', catalog, index);
  assert.deepEqual(knoxList.map((d) => d.id), ['knox-health', 'tri-tn', 'census-county', 'chr']);
  assert.deepEqual(
    knoxList.map((d) => coverageLabel(d.coverage, index)),
    ['Knox County, TN', 'Statewide (TN)', 'National', 'National']
  );

  assert.ok(!datasetsForCounty('47037', catalog, index).includes(knox));
  assert.deepEqual(datasetsForCounty('21111', catalog, index).map((d) => d.id), ['census-county', 'chr']);
  assert.deepEqual(datasetsForCounty('99999', catalog, index), []);
});

test('coverage labels', () => {
  assert.equal(coverageLabel(national1.coverage, index), 'National');
  assert.equal(coverageLabel(tennessee.coverage, index), 'Statewide (TN)');
  assert.equal(coverageLabel(knox.coverage, index), 'Knox County, TN');
  assert.equal(
    coverageLabel([{ level: 'county', geoid: '47093' }, { level: 'state', geoid: '21' }], index),
    'Statewide (KY); Knox County, TN'
  );
  const many = ['47093', '47037', '21111', '47001'].map((geoid) => ({ level: 'county' as const, geoid }));
  assert.equal(coverageLabel(many, index), 'Jefferson County, KY; County 47001; Davidson County, TN; +1 more');
});

test('unknownCoverageFips reports FIPS codes missing from the boundary data', () => {
  assert.deepEqual(unknownCoverageFips(catalog, index), []);
  const bad: CoverageDataset = {
    id: 'bad',
    title: 'Bad',
    coverage: [
      { level: 'county', geoid: '47999' },
      { level: 'state', geoid: '99' },
      { level: 'nation', geoid: 'US' },
    ],
  };
  assert.deepEqual(unknownCoverageFips([bad], index), [
    { datasetId: 'bad', level: 'county', geoid: '47999' },
    { datasetId: 'bad', level: 'state', geoid: '99' },
  ]);
});
