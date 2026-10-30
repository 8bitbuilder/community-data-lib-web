import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';

// The committed output of `npm run geo:boundaries` (Census cartographic boundary files, 2025, 1:20m):
// one TopoJSON file for /maps and the GEOID vocabulary written from the same county file.
interface BoundaryGeometry {
  id: string;
  type: string;
  properties: { name: string; state: string };
}
interface Topology {
  type: string;
  objects: { states: { geometries: BoundaryGeometry[] }; counties: { geometries: BoundaryGeometry[] } };
}
interface Vocabulary {
  vintage: number;
  states: { geoid: string; name: string; usps: string }[];
  counties: { geoid: string; name: string; state: string }[];
}

const topologyUrl = new URL('../public/geo/boundaries/us-2025-20m.topo.json', import.meta.url);
const topology: Topology = JSON.parse(readFileSync(topologyUrl, 'utf8'));
const vocabulary: Vocabulary = JSON.parse(readFileSync(new URL('../src/data/geo-vocabulary.json', import.meta.url), 'utf8'));
const states = topology.objects.states.geometries;
const counties = topology.objects.counties.geometries;

test('the boundary file is TopoJSON under 2 MB', () => {
  assert.equal(topology.type, 'Topology');
  assert.ok(statSync(topologyUrl).size < 2 * 1024 * 1024);
});

test('states: the 50 states and DC, keyed by 2-digit GEOID', () => {
  assert.equal(states.length, 51);
  assert.ok(states.every((g) => /^\d{2}$/.test(g.id)));
  assert.ok(!states.some((g) => g.id === '72'), 'Puerto Rico is left out');
  assert.equal(states.find((g) => g.id === '47')?.properties.state, 'TN');
});

test('counties: unique 5-digit GEOIDs inside the 51 states, all with geometry', () => {
  // 3,144 counties and equivalents in the 2025 vintage (Connecticut as 9 planning regions).
  assert.equal(counties.length, 3144);
  const ids = counties.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  const stateIds = new Set(states.map((g) => g.id));
  assert.ok(counties.every((g) => /^\d{5}$/.test(g.id) && stateIds.has(g.id.slice(0, 2))));
  assert.ok(counties.every((g) => g.type !== null && g.type !== undefined));
});

test('Knox County, TN is 47093', () => {
  const knox = counties.find((g) => g.id === '47093');
  assert.deepEqual(knox?.properties, { name: 'Knox County', state: 'TN' });
});

test('the vocabulary lists exactly the mapped states and counties', () => {
  assert.equal(vocabulary.vintage, 2025);
  assert.deepEqual(vocabulary.states.map((s) => s.geoid), states.map((g) => g.id).sort());
  assert.deepEqual(vocabulary.counties.map((c) => c.geoid), counties.map((g) => g.id).sort());
  assert.deepEqual(vocabulary.states.find((s) => s.geoid === '47'), { geoid: '47', name: 'Tennessee', usps: 'TN' });
  assert.deepEqual(vocabulary.counties.find((c) => c.geoid === '47093'), { geoid: '47093', name: 'Knox County', state: 'TN' });
});
