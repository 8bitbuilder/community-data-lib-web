import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBoundaryIndex,
  classForCount,
  countClasses,
  countsByCounty,
  coverageInCounty,
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

// Tract and zip (ZCTA) coverage, with the counties the backend export lists.
const knoxTracts: CoverageDataset = {
  id: 'knox-tracts',
  title: 'Knox Tracts',
  coverage: [
    { level: 'tract', geoid: '47093004600', counties: ['47093'] },
    { level: 'tract', geoid: '47093004700', counties: ['47093'] },
    { level: 'tract', geoid: '47037019500', counties: ['47037'] },
  ],
};
// A made-up ZCTA crossing from Davidson into Knox, and one wholly in Knox.
const zips: CoverageDataset = {
  id: 'zips',
  title: 'ZIP Data',
  coverage: [
    { level: 'zip', geoid: '37999', counties: ['47037', '47093'] },
    { level: 'zip', geoid: '37919', counties: ['47093'] },
  ],
};

test('tract coverage shades the counties its tracts are in', () => {
  assert.deepEqual([...expandCoverage(knoxTracts.coverage, index)].sort(), ['47037', '47093']);
  assert.ok(!isNational(knoxTracts.coverage));
});

test('zip coverage shades every county a ZCTA crosses into', () => {
  assert.deepEqual([...expandCoverage(zips.coverage, index)].sort(), ['47037', '47093']);
  assert.deepEqual(countsByCounty([zips], index), new Map([['47093', 1], ['47037', 1], ['21111', 0]]));
});

test('tract and zip data is listed first in a county, as the most local', () => {
  const list = datasetsForCounty('47093', [...catalog, knoxTracts, zips], index).map((d) => d.id);
  assert.deepEqual(list.slice(0, 3), ['knox-tracts', 'zips', 'knox-health']);
  assert.deepEqual(datasetsForCounty('21111', [knoxTracts, zips], index), []);
});

test('tract and zip coverage labels', () => {
  assert.equal(coverageLabel(knoxTracts.coverage, index), '1 tract in Davidson County, TN; 2 tracts in Knox County, TN');
  assert.equal(
    coverageLabel(zips.coverage, index),
    'ZIP 37919 (Knox County, TN); ZIP 37999 (Davidson County, TN; Knox County, TN)'
  );
  assert.equal(
    coverageLabel([{ level: 'state', geoid: '21' }, ...knoxTracts.coverage, ...zips.coverage], index),
    'Statewide (KY); 1 tract in Davidson County, TN; 2 tracts in Knox County, TN; +2 more'
  );
});

test('coverageInCounty says how much of a county tract and zip data covers', () => {
  assert.equal(coverageInCounty(knoxTracts.coverage, '47093', index), '2 tracts in this county');
  assert.equal(coverageInCounty(knoxTracts.coverage, '47037', index), '1 tract in this county');
  assert.equal(coverageInCounty(zips.coverage, '47093', index), '2 ZIP codes in this county');
  assert.equal(coverageInCounty(zips.coverage, '47037', index), 'ZIP 37999, which crosses into other counties');
  assert.equal(coverageInCounty([zips.coverage[1]], '47093', index), 'ZIP 37919');
  // A county or wider match keeps the dataset's own label.
  assert.equal(coverageInCounty(knox.coverage, '47093', index), 'Knox County, TN');
  assert.equal(coverageInCounty([{ level: 'nation', geoid: 'US' }, ...zips.coverage], '21111', index), 'National');
});

test('count classes: one per distinct count when they fit, equal ranges otherwise', () => {
  assert.deepEqual(countClasses([7, 7, 0, 7], 5), [{ min: 7, max: 7, step: 2 }]);
  assert.deepEqual(countClasses([7, 8], 5), [
    { min: 7, max: 7, step: 0 },
    { min: 8, max: 8, step: 4 },
  ]);
  assert.deepEqual(countClasses([], 5), []);
  const wide = countClasses([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 5);
  assert.deepEqual(wide.map((c) => [c.min, c.max]), [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10]]);
  assert.equal(classForCount(0, wide), null);
  assert.equal(classForCount(6, wide)?.step, 2);
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

test('unknownCoverageFips checks tract and zip codes and their counties', () => {
  assert.deepEqual(unknownCoverageFips([knoxTracts, zips], index), []);
  const bad: CoverageDataset = {
    id: 'bad',
    title: 'Bad',
    coverage: [
      { level: 'tract', geoid: '4709300460', counties: ['47093'] }, // 10 digits
      { level: 'tract', geoid: '47093004600', counties: ['47037'] }, // not its own county
      { level: 'tract', geoid: '47999004600', counties: ['47999'] }, // unknown county
      { level: 'zip', geoid: '37919' }, // no counties
      { level: 'zip', geoid: '00601', counties: ['72001'] }, // Puerto Rico: not drawn
      { level: 'zip', geoid: '3791', counties: ['47093'] }, // 4 digits
    ],
  };
  assert.deepEqual(
    unknownCoverageFips([bad], index).map((u) => u.level + ' ' + u.geoid),
    ['tract 4709300460', 'tract 47093004600', 'tract 47999004600', 'zip 37919', 'zip 00601', 'zip 3791']
  );
});
