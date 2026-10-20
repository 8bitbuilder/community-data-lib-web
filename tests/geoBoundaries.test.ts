import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The committed output of `npm run geo:boundaries` (Census cartographic boundary files, 2025, 1:20m).
interface BoundaryFeature {
  id: string;
  properties: { GEOID: string; name: string; state: string };
  geometry: { type: string } | null;
}

function load(name: string): BoundaryFeature[] {
  const url = new URL(`../public/geo/boundaries/${name}`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')).features;
}

const states = load('us-states-2025-20m.geojson');
const counties = load('us-counties-2025-20m.geojson');

test('states: the 50 states and DC, keyed by 2-digit GEOID', () => {
  assert.equal(states.length, 51);
  assert.ok(states.every((f) => /^\d{2}$/.test(f.properties.GEOID) && f.id === f.properties.GEOID));
  assert.ok(!states.some((f) => f.properties.GEOID === '72'), 'Puerto Rico is left out');
  assert.equal(states.find((f) => f.properties.GEOID === '47')?.properties.state, 'TN');
});

test('counties: unique 5-digit GEOIDs inside the 51 states', () => {
  // 3,144 counties and equivalents in the 2025 vintage (Connecticut as 9 planning regions).
  assert.equal(counties.length, 3144);
  const ids = counties.map((f) => f.properties.GEOID);
  assert.equal(new Set(ids).size, ids.length);
  const stateIds = new Set(states.map((f) => f.properties.GEOID));
  assert.ok(counties.every((f) => /^\d{5}$/.test(f.properties.GEOID) && stateIds.has(f.properties.GEOID.slice(0, 2))));
  assert.ok(counties.every((f) => f.geometry !== null));
});

test('Knox County, TN is 47093', () => {
  const knox = counties.find((f) => f.properties.GEOID === '47093');
  assert.deepEqual(knox?.properties, { GEOID: '47093', name: 'Knox County', state: 'TN' });
});
