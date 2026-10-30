import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  createVocabulary,
  describeCounty,
  findUnknownGeoids,
  isKnownCoverage,
} from '../src/lib/community/geoVocabulary.mjs';

const fixture = createVocabulary({
  vintage: 2025,
  states: [
    { geoid: '47', name: 'Tennessee', usps: 'TN' },
    { geoid: '21', name: 'Kentucky', usps: 'KY' },
  ],
  counties: [
    { geoid: '47093', name: 'Knox County', state: 'TN' },
    { geoid: '21111', name: 'Jefferson County', state: 'KY' },
  ],
});

test('coverage entries must name a known nation, state or county', () => {
  assert.equal(isKnownCoverage(fixture, { level: 'nation', geoid: 'US' }), true);
  assert.equal(isKnownCoverage(fixture, { level: 'state', geoid: '47' }), true);
  assert.equal(isKnownCoverage(fixture, { level: 'county', geoid: '47093' }), true);
  assert.equal(isKnownCoverage(fixture, { level: 'nation', geoid: '47' }), false);
  assert.equal(isKnownCoverage(fixture, { level: 'state', geoid: '72' }), false);
  assert.equal(isKnownCoverage(fixture, { level: 'county', geoid: '47' }), false);
  assert.equal(isKnownCoverage(fixture, { level: 'county', geoid: '09001' }), false);
});

test('findUnknownGeoids lists every bad dataset coverage and community FIPS by file', () => {
  const problems = findUnknownGeoids(fixture, {
    datasets: [
      { file: 'ok.md', coverage: [{ level: 'nation', geoid: 'US' }, { level: 'county', geoid: '47093' }] },
      { file: 'bad.md', coverage: [{ level: 'state', geoid: '99' }, { level: 'county', geoid: '47999' }] },
      { file: 'none.md' },
    ],
    communities: [
      { file: 'knox.md', county_fips: '47093' },
      { file: 'old-ct.md', county_fips: '09001' },
      { file: 'missing.md' },
    ],
  });
  assert.deepEqual(problems, [
    { file: 'bad.md', problem: 'coverage state 99' },
    { file: 'bad.md', problem: 'coverage county 47999' },
    { file: 'old-ct.md', problem: 'county_fips 09001' },
    { file: 'missing.md', problem: 'county_fips (missing)' },
  ]);
});

test('describeCounty derives the state code and county name from the FIPS code', () => {
  assert.deepEqual(describeCounty(fixture, '47093'), {
    county_fips: '47093',
    county: 'Knox County',
    state_code: 'TN',
    state_name: 'Tennessee',
  });
  assert.equal(describeCounty(fixture, '00000'), null);
  assert.equal(describeCounty(fixture, undefined), null);
});

test('the committed vocabulary is the 2025 county list (Connecticut planning regions)', () => {
  const vocabulary = createVocabulary(
    JSON.parse(readFileSync(new URL('../src/data/geo-vocabulary.json', import.meta.url), 'utf8'))
  );
  assert.equal(describeCounty(vocabulary, '47093')?.state_code, 'TN');
  // Connecticut uses planning regions from the 2022 vintage on.
  assert.equal(vocabulary.county('09001'), null);
  assert.equal(vocabulary.county('09110')?.state, 'CT');
});
