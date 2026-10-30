import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  ApiError,
  fetchPreview,
  fetchChart,
  fetchFilterOptions,
  fetchSourceFile,
  parseSheetParam,
} from '../src/lib/api/backend.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(response: Response): { urls: string[] } {
  const seen = { urls: [] as string[] };
  globalThis.fetch = (async (input: string | URL | Request) => {
    seen.urls.push(String(input));
    return response.clone();
  }) as typeof fetch;
  return seen;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

test('ApiError carries status and body and keeps the message text', async () => {
  stub(json({ error: 'Unknown sheet: Nope', code: 'UNKNOWN_SHEET', sheets: ['A'] }, 400));
  await assert.rejects(fetchPreview('x', { sheet: 9 }), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.ok(err instanceof Error);
    assert.equal(err.status, 400);
    assert.equal(err.body.code, 'UNKNOWN_SHEET');
    assert.deepEqual(err.body.sheets, ['A']);
    assert.equal(err.message, 'Unknown sheet: Nope');
    return true;
  });
});

test('ApiError message combines error and details as before', async () => {
  stub(json({ error: 'Bad', details: 'more' }, 500));
  await assert.rejects(fetchPreview('x'), (err: unknown) => {
    assert.equal((err as ApiError).message, 'Bad (more)');
    return true;
  });
});

test('fetchPreview sends sheet and header_row, including sheet index 0', async () => {
  const seen = stub(json({ columns: [], rows: [], total: 0 }));
  await fetchPreview('s', { sheet: 2, headerRow: 3, limit: 5 });
  let q = new URL(seen.urls[0], 'http://x').searchParams;
  assert.equal(q.get('sheet'), '2');
  assert.equal(q.get('header_row'), '3');
  await fetchPreview('s', { sheet: 0 });
  q = new URL(seen.urls[1], 'http://x').searchParams;
  assert.equal(q.get('sheet'), '0');
  assert.equal(q.has('header_row'), false);
  await fetchPreview('s');
  assert.equal(seen.urls[2].includes('sheet'), false);
});

test('parseSheetParam: the sheet param is a 0-based index, never a name', () => {
  assert.equal(parseSheetParam('0'), 0);
  assert.equal(parseSheetParam('2'), 2);
  assert.equal(parseSheetParam(null), undefined);
  assert.equal(parseSheetParam(''), undefined);
  assert.equal(parseSheetParam('Data'), undefined);
  assert.equal(parseSheetParam('-1'), undefined);
  assert.equal(parseSheetParam('1.5'), undefined);
});

test('a sheet named like a number ("2024") is sent as its index', async () => {
  const seen = stub(json({ columns: [], rows: [], total: 0 }));
  const sheets = ['Notes', '2023', '2024'];
  await fetchPreview('s', { sheet: sheets.indexOf('2024') });
  const q = new URL(seen.urls[0], 'http://x').searchParams;
  assert.equal(q.get('sheet'), '2');
  // ...and the page's URL value round-trips back to the same sheet.
  assert.equal(sheets[parseSheetParam(q.get('sheet'))!], '2024');
});

test('fetchChart and fetchFilterOptions pass the layout params', async () => {
  const seen = stub(json({ options: [], variable: 'v', label: 'v' }));
  await fetchChart('s', { variable: 'v', sheet: 1, headerRow: 2 });
  let q = new URL(seen.urls[0], 'http://x').searchParams;
  assert.equal(q.get('sheet'), '1');
  assert.equal(q.get('header_row'), '2');
  await fetchFilterOptions('s', 'state', undefined, { sheet: 3, headerRow: 4 });
  q = new URL(seen.urls[1], 'http://x').searchParams;
  assert.equal(q.get('type'), 'state');
  assert.equal(q.get('sheet'), '3');
  assert.equal(q.get('header_row'), '4');
});

test('fetchSourceFile decodes filename and reads format and archive headers', async () => {
  const seen = stub(
    new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: {
        'X-CDL-Filename': '%C3%A9t%C3%A9.csv',
        'X-CDL-Format': 'csv',
        'X-CDL-Archive': 'zip',
        'X-CDL-Archive-Entry': 'data%2Fsub%2F%C3%A9t%C3%A9.csv',
      },
    }),
  );
  const file = await fetchSourceFile('a b');
  assert.equal(file.archiveEntry, 'data/sub/été.csv');
  assert.ok(seen.urls[0].endsWith('/api/sources/a%20b/file'));
  assert.equal(file.filename, 'été.csv');
  assert.equal(file.format, 'csv');
  assert.equal(file.archive, 'zip');
  assert.deepEqual([...file.bytes], [1, 2, 3]);
});

test('fetchSourceFile reports archive null when the header is absent', async () => {
  stub(new Response('x', { headers: { 'X-CDL-Filename': 'a.xlsx', 'X-CDL-Format': 'xlsx' } }));
  const file = await fetchSourceFile('s');
  assert.equal(file.archive, null);
  assert.equal(file.archiveEntry, null);
  assert.equal(file.format, 'xlsx');
});

test('fetchSourceFile turns 413 into an ApiError with size and downloadUrl', async () => {
  stub(json({ error: 'File too large', size: 99, downloadUrl: 'http://x/f' }, 413));
  await assert.rejects(fetchSourceFile('s'), (err: unknown) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 413);
    assert.equal(err.body.size, 99);
    assert.equal(err.body.downloadUrl, 'http://x/f');
    return true;
  });
});
