/**
 * Download the Census cartographic boundary files for states and counties and
 * write, from the same county file:
 *   - public/geo/boundaries/us-<vintage>-<resolution>.topo.json  display geometry for /maps
 *     (TopoJSON, objects "states" and "counties", feature id = GEOID)
 *   - src/data/geo-vocabulary.json  every state and county GEOID with its name and
 *     USPS code; the build checks dataset coverage and community FIPS against it
 *   - public/geo/boundaries/README.md  provenance
 *
 * The output is committed. This script is NOT part of prebuild: builds must not
 * depend on census.gov being up. Re-run it only to bump the vintage.
 *
 * Usage:
 *   npm run geo:boundaries
 *   npm run geo:boundaries -- --from <dir>       use zips downloaded by hand into <dir>
 *   npm run geo:boundaries -- --backend ../backend  also copy the vocabulary to
 *                                                   <backend>/data/reference/geo-vocabulary.json
 *
 * Coverage on the /maps page is defined by FIPS codes alone; this geometry is
 * for display only.
 */

import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

// Bump these to move to a newer release (check the GENZ<year> folder exists first).
export const VINTAGE = 2025;
export const RESOLUTION = '20m';
// TopoJSON quantization: coordinates snap to a 100,000 × 100,000 grid over the
// map's extent (about 0.001°, ~100 m), far finer than a 1:20m file resolves.
const QUANTIZATION = 100_000;
// Extra mapshaper simplification on top of the Census generalization; null keeps the file as published.
const SIMPLIFY = null;
// Served from public/ and fetched by every /maps visit; keep it well under Netlify's large-file range.
const MAX_BOUNDARY_BYTES = 2 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/geo/boundaries');
const vocabularyPath = path.resolve(__dirname, '../src/data/geo-vocabulary.json');
const baseUrl = `https://www2.census.gov/geo/tiger/GENZ${VINTAGE}/shp`;
const mapshaperVersion = createRequire(import.meta.url)('mapshaper/package.json').version;

// "Nation" on the map means the 50 states and DC; Puerto Rico (72) and the island areas are left out.
const LAYERS = [
  { key: 'states', layer: 'state', nameField: 'NAME', stateNameField: 'NAME' },
  { key: 'counties', layer: 'county', nameField: 'NAMELSAD', stateNameField: 'STATE_NAME' },
];

export function zipName(layer) {
  return `cb_${VINTAGE}_us_${layer}_${RESOLUTION}.zip`;
}

export function outputName() {
  return `us-${VINTAGE}-${RESOLUTION}.topo.json`;
}

async function download(url, dest) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Download failed (HTTP ${response.status}): ${url}`);
  await writeFile(dest, Buffer.from(await response.arrayBuffer()));
}

/**
 * The Aleutian Islands cross the antimeridian, so part of Alaska arrives at
 * longitudes near +180. Shift those by -360 so Leaflet draws Alaska in one piece.
 */
function shiftAleutians(collection) {
  const shift = (coords) =>
    typeof coords[0] === 'number' ? (coords[0] > 0 ? [coords[0] - 360, coords[1]] : coords) : coords.map(shift);
  for (const feature of collection.features) {
    if (feature.properties.GEOID.startsWith('02') && feature.geometry) {
      feature.geometry.coordinates = shift(feature.geometry.coordinates);
    }
  }
}

/** Unzip-free: mapshaper reads the shapefile straight from the zip. Returns a GeoJSON FeatureCollection. */
async function readLayer(workDir, zip, { key, nameField, stateNameField }) {
  const raw = path.join(workDir, `${key}.raw.geojson`);
  const commands = [
    `-i "${zip}"`,
    '-proj wgs84',
    `-filter "Number(STATEFP) < 60 && STATEFP !== '72'"`,
    `-each "name=${nameField}, state=STUSPS, state_name=${stateNameField}"`,
    '-filter-fields GEOID,name,state,state_name',
    `-o format=geojson "${raw}"`,
  ];
  await mapshaper.runCommands(commands.join(' '));
  const collection = JSON.parse(await readFile(raw, 'utf8'));
  shiftAleutians(collection);
  collection.features.sort((a, b) => a.properties.GEOID.localeCompare(b.properties.GEOID));
  return collection;
}

/**
 * States and counties for the build-time checks and the Data Preview county names,
 * both taken from the county file so every county's state is in the list.
 */
export function buildVocabulary(counties, sources) {
  const states = new Map();
  const countyRows = counties.features.map(({ properties: p }) => {
    const stateGeoid = p.GEOID.slice(0, 2);
    if (!states.has(stateGeoid)) states.set(stateGeoid, { geoid: stateGeoid, name: p.state_name, usps: p.state });
    return { geoid: p.GEOID, name: p.name, state: p.state };
  });
  return {
    vintage: VINTAGE,
    resolution: RESOLUTION,
    source: sources.counties,
    states: [...states.values()].sort((a, b) => a.geoid.localeCompare(b.geoid)),
    counties: countyRows,
  };
}

/** One record per line keeps diffs readable when the vintage is bumped. */
export function serializeVocabulary(vocabulary) {
  const rows = (list) => list.map((row) => `    ${JSON.stringify(row)}`).join(',\n');
  return [
    '{',
    `  "vintage": ${vocabulary.vintage},`,
    `  "resolution": ${JSON.stringify(vocabulary.resolution)},`,
    `  "source": ${JSON.stringify(vocabulary.source)},`,
    '  "states": [',
    rows(vocabulary.states),
    '  ],',
    '  "counties": [',
    rows(vocabulary.counties),
    '  ]',
    '}',
    '',
  ].join('\n');
}

async function writeTopology(workDir, layers) {
  const inputs = [];
  for (const [key, collection] of Object.entries(layers)) {
    for (const feature of collection.features) {
      const { GEOID, name, state } = feature.properties;
      feature.properties = { GEOID, name, state };
    }
    const file = path.join(workDir, `${key}.geojson`);
    await writeFile(file, JSON.stringify(collection), 'utf8');
    inputs.push(`"${file}"`);
  }
  const outPath = path.join(outDir, outputName());
  const commands = [
    `-i ${inputs.join(' ')} combine-files`,
    ...(SIMPLIFY ? [`-simplify ${SIMPLIFY} keep-shapes`] : []),
    `-o format=topojson quantization=${QUANTIZATION} id-field=GEOID "${outPath}"`,
  ];
  await mapshaper.runCommands(commands.join(' '));

  // GEOID is already the feature id; drop the duplicate property to save space.
  const topology = JSON.parse(await readFile(outPath, 'utf8'));
  for (const object of Object.values(topology.objects)) {
    for (const geometry of object.geometries) delete geometry.properties.GEOID;
  }
  await writeFile(outPath, `${JSON.stringify(topology)}\n`, 'utf8');
  const { size } = await stat(outPath);
  if (size > MAX_BOUNDARY_BYTES) {
    throw new Error(`${outPath} is ${(size / 1024).toFixed(0)} KB, over the ${MAX_BOUNDARY_BYTES / 1024} KB limit.`);
  }
  console.log(`  → ${outPath} (${(size / 1024).toFixed(0)} KB)`);
  return size;
}

function provenance({ sources, counts, size }) {
  return `# Census boundary file for /maps

Generated by \`npm run geo:boundaries\` (\`scripts/build-geo-boundaries.mjs\`). Do not edit by hand.

| File | Objects | Size |
|---|---|---|
| \`${outputName()}\` | \`states\` (${counts.states}), \`counties\` (${counts.counties}) | ${(size / 1024).toFixed(0)} KB |

- **Source**: U.S. Census Bureau cartographic boundary files (generalized from TIGER/Line for display),
  https://www.census.gov/geographies/mapping-files/time-series/geo/cartographic-boundary.html
  - ${sources.states}
  - ${sources.counties}
- **Vintage**: ${VINTAGE}
- **Resolution**: 1:${RESOLUTION.replace('m', ',000,000')} (\`${RESOLUTION}\`)
- **Processing** (mapshaper ${mapshaperVersion}): reprojected from NAD83 to WGS84; kept the 50 states and DC
  (Puerto Rico and the island areas are left out); feature \`id\` = GEOID, properties \`name\` and \`state\`
  (USPS code); Aleutian longitudes past 180° shifted by −360; written as TopoJSON with shared arcs,
  quantization ${QUANTIZATION.toLocaleString('en-US')}.
- **Simplification**: ${SIMPLIFY ? `mapshaper \`-simplify ${SIMPLIFY} keep-shapes\`` : 'none beyond the Census generalization'}.
- **Vocabulary**: \`src/data/geo-vocabulary.json\` (every state and county GEOID, name and USPS code) is written
  from the same county file.
- **Generated**: ${new Date().toISOString().slice(0, 10)}

The map's coverage comes from dataset FIPS codes, not from this geometry; the build fails if a
dataset's coverage FIPS or a community's county FIPS is not in the vocabulary.
`;
}

async function main() {
  const { values } = parseArgs({ options: { from: { type: 'string' }, backend: { type: 'string' } } });
  await mkdir(outDir, { recursive: true });
  const workDir = await mkdtemp(path.join(os.tmpdir(), 'cdl-geo-'));
  try {
    const layers = {};
    const sources = {};
    for (const spec of LAYERS) {
      const url = `${baseUrl}/${zipName(spec.layer)}`;
      sources[spec.key] = url;
      let zip = path.join(workDir, zipName(spec.layer));
      if (values.from) {
        zip = path.resolve(values.from, zipName(spec.layer));
        console.log(`Reading ${zip}`);
      } else {
        console.log(`Downloading ${url}`);
        await download(url, zip);
      }
      layers[spec.key] = await readLayer(workDir, zip, spec);
    }

    const vocabulary = buildVocabulary(layers.counties, sources);
    const stateIds = layers.states.features.map((f) => f.properties.GEOID).join();
    if (vocabulary.states.map((s) => s.geoid).join() !== stateIds) {
      throw new Error('The state file and the states in the county file disagree; check the vintage.');
    }
    await mkdir(path.dirname(vocabularyPath), { recursive: true });
    await writeFile(vocabularyPath, serializeVocabulary(vocabulary), 'utf8');
    console.log(`  → ${vocabularyPath} (${vocabulary.states.length} states, ${vocabulary.counties.length} counties)`);
    if (values.backend) {
      const backendCopy = path.resolve(values.backend, 'data/reference/geo-vocabulary.json');
      await mkdir(path.dirname(backendCopy), { recursive: true });
      await copyFile(vocabularyPath, backendCopy);
      console.log(`  → ${backendCopy}`);
    }

    const counts = { states: layers.states.features.length, counties: layers.counties.features.length };
    const size = await writeTopology(workDir, layers);
    await writeFile(path.join(outDir, 'README.md'), provenance({ sources, counts, size }), 'utf8');
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    console.error(
      `If census.gov is unreachable, download these by hand and re-run with --from <folder>:\n` +
        LAYERS.map((l) => `  ${baseUrl}/${zipName(l.layer)}`).join('\n')
    );
    process.exit(1);
  });
}
