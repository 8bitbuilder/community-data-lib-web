import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { createApiHandler, nodeEngine } from '../backend/lib/apiHandler.mjs';

// A tiny local "data provider" so tests never touch the network.
const CSV = [
  'STATE,COUNTY,STNAME,CTYNAME,POPESTIMATE2025',
  '47,093,Tennessee,Knox County,500000',
  '47,037,Tennessee,Davidson County,720000',
  '37,183,North Carolina,Wake County,1200000',
].join('\n');

let server: http.Server;
let base = '';

before(async () => {
  server = http.createServer((req, res) => {
    if (req.url === '/counties.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv' });
      res.end(CSV);
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
    { id: 'excel', title: 'Excel', download: { url: `${base}/file.xlsx` } },
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
  assert.equal(list.body.count, 3);
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
  const excel = await get('/api/sources/excel/preview');
  assert.equal(excel.status, 422);
  assert.match(excel.body.details, /XLSX/);
  const portal = await get('/api/sources/portal/preview');
  assert.equal(portal.status, 422);
  assert.match(portal.body.details, /no download URL/);
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
