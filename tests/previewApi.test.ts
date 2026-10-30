import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';

import { createApiHandler, nodeEngine } from '../backend/lib/apiHandler.mjs';
import { getSourceTable, tableCacheSize } from '../backend/lib/csvCache.mjs';
import { loadAllSources as loadExported } from '../backend/lib/exportStore.mjs';
import previewFunction, { config as functionConfig } from '../netlify/functions/preview-api.mjs';

// A tiny local "data provider" so tests never touch the network.
const CSV = [
  'STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2025',
  '47,093,Tennessee,Knox County,500000',
  '47,037,Tennessee,Davidson County,720000',
  '37,183,North Carolina,Wake County,1200000',
].join('\n');

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const ZIP = (() => {
  const zip = new AdmZip();
  zip.addFile('title-rows.xlsx', fixture('title-rows.xlsx'));
  return zip.toBuffer();
})();

let server: http.Server;
let base = '';

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/counties.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv' });
      res.end(CSV);
    } else if (req.url === '/bundle.zip') {
      res.writeHead(200, { 'Content-Type': 'application/zip' });
      res.end(ZIP);
    } else if (req.url?.startsWith('/fx/')) {
      try {
        const body = fixture(req.url.slice(4));
        res.writeHead(200);
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => server.close());

function sources() {
  return [
    {
      id: 'counties',
      title: 'Counties',
      download: { url: `${base}/counties.csv` },
      variables: ['CTYNAME', 'POPESTIMATE2025'],
    },
    { id: 'excel', title: 'Excel', download: { url: `${base}/fx/title-rows.xlsx` } },
    {
      id: 'excel-curated',
      title: 'Excel curated',
      download: { url: `${base}/fx/title-rows.xlsx`, header_row: 1 },
    },
    { id: 'empty', title: 'Empty', download: { url: `${base}/fx/empty.xlsx` } },
    { id: 'zipped', title: 'Zipped', download: { url: `${base}/bundle.zip` } },
    { id: 'notes-first', title: 'Notes', download: { url: `${base}/fx/notes-first.xlsx` } },
    { id: 'numeric-sheets', title: 'Years', download: { url: `${base}/fx/numeric-sheets.xlsx` } },
    { id: 'portal', title: 'Portal only', provider: { url: 'https://example.gov' } },
  ];
}

function makeHandler() {
  return createApiHandler({
    loadAllSources: async () => sources(),
    loadSourceById: async (id: string) => sources().find((s) => s.id === id) ?? null,
    engine: nodeEngine,
  });
}

async function get(path: string, handle = makeHandler()) {
  const response = await handle(new Request(`http://site.test${path}`));
  return { status: response.status, body: await response.json(), headers: response.headers };
}

test('health and source listing', async () => {
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.previewEngine, 'node');
  const list = await get('/api/sources');
  assert.equal(list.body.count, 8);
  assert.equal((await get('/api/sources/counties')).body.title, 'Counties');
  assert.equal(list.headers.get('access-control-allow-origin'), '*');
});

test('unknown source and route return 404', async () => {
  assert.equal((await get('/api/sources/nope')).status, 404);
  assert.equal((await get('/api/sources/counties/nope')).status, 404);
  assert.equal((await get('/api/other')).status, 404);
});

test('preview table with state and county filters (Node engine)', async () => {
  const all = await get('/api/sources/counties/preview?limit=10');
  assert.equal(all.status, 200);
  assert.equal(all.body.engine, 'node');
  const tn = await get('/api/sources/counties/preview?state=47');
  const knox = await get('/api/sources/counties/preview?state=47&county=093');
  const count = (b: { rows?: unknown[]; totalRows?: number }) => b.totalRows ?? b.rows?.length;
  assert.ok(count(tn.body)! < count(all.body)!);
  assert.equal(count(knox.body), 1);
});

test('chart and filter options', async () => {
  const chart = await get('/api/sources/counties/chart?variable=POPESTIMATE2025');
  assert.equal(chart.status, 200);
  assert.ok(Array.isArray(chart.body.series) && chart.body.series.length > 0);
  const states = await get('/api/sources/counties/filters?type=state');
  assert.equal(states.status, 200);
  assert.ok(Array.isArray(states.body.options) && states.body.options.length === 2);
});

test('datasets that cannot be previewed get a clear 422, not a crash', async () => {
  const portal = await get('/api/sources/portal/preview');
  assert.equal(portal.status, 422);
  assert.match(portal.body.details, /no download URL/);
});

test('the Netlify function serves the real SQLite export', async () => {
  assert.deepEqual(functionConfig.path, ['/api/health', '/api/sources', '/api/sources/*']);
  const exported = await loadExported();
  const list = await get('/api/sources', previewFunction);
  assert.equal(list.status, 200);
  assert.equal(list.body.count, exported.length);
  const health = await get('/api/health', previewFunction);
  assert.equal(health.body.runtime, 'netlify-function');
  assert.equal(health.body.dataSource, 'sqlite-export');
  const milk = await get('/api/sources/usda-milk-production', previewFunction);
  assert.equal(milk.status, 200);
  assert.deepEqual(milk.body.coverage, [{ level: 'nation', geoid: 'US' }]);
});

test('an unreachable data provider returns 502', async () => {
  const handle = createApiHandler({
    loadAllSources: async () => [],
    loadSourceById: async (id: string) => ({
      id,
      title: 'Gone',
      download: { url: `${base}/missing.csv` },
    }),
  });
  const res = await get('/api/sources/gone/preview', handle);
  assert.equal(res.status, 502);
});

test('the site never serves raw dataset files (visitors download from the provider)', async () => {
  const res = await get('/api/sources/counties/file');
  assert.equal(res.status, 404);
});

test('Excel preview returns rows and layout', async () => {
  const res = await get('/api/sources/excel/preview');
  assert.equal(res.status, 200);
  assert.equal(res.body.layout.headerRow, 4);
  assert.equal(res.body.total, 5);
});

test('zipped Excel previews too', async () => {
  const res = await get('/api/sources/zipped/preview');
  assert.equal(res.status, 200);
  assert.equal(res.body.layout.headerRow, 4);
});

test('curator header_row is honored and visitor param overrides it', async () => {
  const curated = await get('/api/sources/excel-curated/preview');
  assert.equal(curated.status, 200);
  assert.equal(curated.body.layout.headerRow, 1);
  assert.equal(curated.body.layout.origin.headerRow, 'curator');
  const visitor = await get('/api/sources/excel-curated/preview?header_row=4');
  assert.equal(visitor.body.layout.headerRow, 4);
  assert.equal(visitor.body.layout.origin.headerRow, 'visitor');
});

test('sheet param selects a sheet (digits are an index)', async () => {
  const byName = await get('/api/sources/notes-first/preview?sheet=Data');
  assert.equal(byName.status, 200);
  assert.equal(byName.body.layout.sheet, 'Data');
  const byIndex = await get('/api/sources/notes-first/preview?sheet=1');
  assert.equal(byIndex.body.layout.sheet, 'Data');
});

test('sheets named like numbers are chosen by index, never read as positions', async () => {
  const auto = await get('/api/sources/numeric-sheets/preview');
  assert.equal(auto.status, 200);
  assert.deepEqual(auto.body.layout.sheets, ['Notes', '2023', '2024']);
  assert.equal(auto.body.layout.sheet, '2023');
  // The page sends layout.sheets.indexOf("2024") === 2.
  const y2024 = await get('/api/sources/numeric-sheets/preview?sheet=2');
  assert.equal(y2024.status, 200);
  assert.equal(y2024.body.layout.sheet, '2024');
  assert.deepEqual(y2024.body.columns, ['County', 'Pop', 'Change']);
  assert.equal(y2024.body.total, 3);
  // "1" is the second sheet ("2023"), not a sheet named "1"; "2024" is out of range.
  const one = await get('/api/sources/numeric-sheets/preview?sheet=1');
  assert.equal(one.body.layout.sheet, '2023');
  const asName = await get('/api/sources/numeric-sheets/preview?sheet=2024');
  assert.equal(asName.status, 400);
  assert.equal(asName.body.code, 'UNKNOWN_SHEET');
});

test('unknown sheet and out-of-range header row are 400 with sheet list', async () => {
  const bad = await get('/api/sources/excel/preview?sheet=Nope');
  assert.equal(bad.status, 400);
  assert.ok(Array.isArray(bad.body.sheets) && bad.body.sheets.length > 0);
  assert.equal(bad.body.code, 'UNKNOWN_SHEET');
  const hdr = await get('/api/sources/excel/preview?header_row=99');
  assert.equal(hdr.status, 400);
  assert.equal(hdr.body.code, 'HEADER_OUT_OF_RANGE');
});

test('Excel sources skip a preferred pandas engine', async () => {
  const boom = () => {
    throw new Error('pandas must not be called');
  };
  const handle = createApiHandler({
    loadAllSources: async () => sources(),
    loadSourceById: async (id: string) => sources().find((s) => s.id === id) ?? null,
    engine: { name: 'pandas', buildPreview: boom, buildChart: boom, listFilterOptions: boom },
  });
  const res = await get('/api/sources/excel/preview', handle);
  assert.equal(res.status, 200);
  assert.equal(res.body.engine, 'node');
  assert.equal(res.body.pandasFallback, undefined);
});

test('invalid header_row values are 400, not ignored', async () => {
  for (const bad of ['0', 'abc', '-1', '1.5']) {
    const res = await get(`/api/sources/excel/preview?header_row=${bad}`);
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.code, 'HEADER_OUT_OF_RANGE');
    assert.equal(res.body.error, 'header_row must be a whole number of 1 or more');
  }
});

test('a sheet with no data rows is 422 NO_DATA', async () => {
  const res = await get('/api/sources/empty/preview');
  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'NO_DATA');
  assert.equal(res.body.error, 'This sheet has no data rows');
});

test('the parsed-table cache is bounded', async () => {
  for (let i = 0; i < 60; i++) {
    await getSourceTable({ id: `cap-${i}`, download: { url: `${base}/counties.csv` } });
  }
  assert.equal(tableCacheSize(), 50);
});
