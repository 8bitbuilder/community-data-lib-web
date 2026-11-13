import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

// @ts-expect-error plain .mjs module without types
import { checkCatalogScope, isNationalLevel } from '../backend/lib/catalogScope.mjs';
// @ts-expect-error plain .mjs module without types
import { loadAllSources, loadSourceById } from '../backend/lib/sourceStore.mjs';
// @ts-expect-error plain .mjs module without types
import { assertCatalogInScope, coverageLine } from '../scripts/sync-catalog-from-backend.mjs';

const NONE = { year: true, state: false, county: false, zipcode: false };

const EXCLUDED = [
  'census-annual-pop-by-age-sex-2025',
  'census-annual-pop-selected-age-groups-2024',
  'usda-milk-production',
];

const catalog = JSON.parse(readFileSync('backend/data/exports/catalog.json', 'utf8'));

test('national-only is national-level', () => {
  assert.equal(isNationalLevel(NONE), true);
});

test('state-only, county and ZIP-only are kept', () => {
  assert.equal(isNationalLevel({ ...NONE, state: true }), false);
  assert.equal(isNationalLevel({ ...NONE, county: true }), false);
  assert.equal(isNationalLevel({ ...NONE, zipcode: true }), false);
});

test('missing filters are reported, not passed as local', () => {
  const scope = checkCatalogScope([{ id: 'a' }, { id: 'b', filters: {} }, { id: 'c', filters: NONE }, { id: 'd', filters: { ...NONE, state: true } }]);
  assert.deepEqual(scope, { national: ['c'], missingFilters: ['a', 'b'] });
});

test('the sync stops on a national-level source or missing filters', () => {
  assert.throws(() => assertCatalogInScope([{ id: 'us-totals', filters: NONE }]), /national-level: us-totals/);
  assert.throws(() => assertCatalogInScope([{ id: 'no-filters' }]), /no filters: no-filters/);
  assert.doesNotThrow(() => assertCatalogInScope([{ id: 'ok', filters: { ...NONE, county: true } }]));
});

test('the committed export follows the rule and lists what it left out', () => {
  const scope = checkCatalogScope(catalog.sources);
  assert.deepEqual(scope.national, []);
  assert.deepEqual(scope.missingFilters, []);
  assert.deepEqual(catalog.excludedNationalLevel, EXCLUDED);
});

test('no generated catalog page exists for an excluded dataset', () => {
  const pages = readdirSync('src/content/master-library/datasets').map((name) => name.replace(/\.md$/, ''));
  assert.deepEqual(pages.sort(), catalog.sources.map((source: { id: string }) => source.id).sort());
  for (const id of EXCLUDED) assert.equal(pages.includes(id), false, id);
});

test('the preview API serves catalog sources only', async () => {
  const ids = (await loadAllSources()).map((source: { id: string }) => source.id);
  assert.deepEqual(ids.sort(), catalog.sources.map((source: { id: string }) => source.id).sort());
  for (const id of EXCLUDED) assert.equal(await loadSourceById(id), null, id);
  assert.equal((await loadSourceById('chr-analytic-data-2025')).id, 'chr-analytic-data-2025');
});

test('coverageLine keeps the counties of tract and zip coverage in the frontmatter', () => {
  assert.equal(coverageLine({ level: 'nation', geoid: 'US' }), '  - { level: "nation", geoid: "US" }');
  assert.equal(coverageLine({ level: 'county', geoid: '47093' }), '  - { level: "county", geoid: "47093" }');
  assert.equal(
    coverageLine({ level: 'tract', geoid: '47093004600', counties: ['47093'] }),
    '  - { level: "tract", geoid: "47093004600", counties: ["47093"] }'
  );
  assert.equal(
    coverageLine({ level: 'zip', geoid: '37801', counties: ['47009', '47123'] }),
    '  - { level: "zip", geoid: "37801", counties: ["47009", "47123"] }'
  );
});
