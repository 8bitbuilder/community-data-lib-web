import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createVocabulary } from '../src/lib/community/geoVocabulary.mjs';
import { createFileStore, isMissingTable, loadCommunities } from '../src/lib/community/communityStore.mjs';

const vocabulary = createVocabulary({
  vintage: 2025,
  states: [{ geoid: '47', name: 'Tennessee', usps: 'TN' }],
  counties: [
    { geoid: '47093', name: 'Knox County', state: 'TN' },
    { geoid: '47037', name: 'Davidson County', state: 'TN' },
  ],
});

function filesDir(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cdl-communities-'));
  for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text);
  return dir;
}

const knoxFile = [
  '---',
  'name: Knox County Data Library',
  'place_name: Knoxville',
  'slug: knox-county',
  'description: Open data for Knox County.',
  'state_code: TN',
  'county: Knox County',
  'county_fips: "47093"',
  'zip_codes:',
  '  - "37901"',
  '---',
  '',
  'Body.',
].join('\n');

function quietLog() {
  const warnings: string[] = [];
  return { warnings, log: { warn: (m: string) => warnings.push(m), info: () => {} } };
}

const fakeDb = (rows: object[] | Error) => {
  const calls: string[] = [];
  let closed = false;
  return {
    calls,
    closed: () => closed,
    connect: async () => ({
      query: async (text: string) => {
        calls.push(text);
        if (rows instanceof Error) throw rows;
        return rows;
      },
      close: async () => {
        closed = true;
      },
    }),
  };
};

const missingTable = Object.assign(new Error('relation "communities" does not exist'), { code: '42P01' });

test('the file store reads the Markdown records and drops fields the database does not have', async () => {
  const records = await createFileStore(filesDir({ 'knox-county.md': knoxFile, 'notes.txt': 'x' })).listPublished();
  assert.deepEqual(records, [
    { slug: 'knox-county', name: 'Knox County Data Library', place_name: 'Knoxville', description: 'Open data for Knox County.', county_fips: '47093' },
  ]);
});

test('with NETLIFY_DB_URL the build reads approved libraries from the database and closes the pool', async () => {
  const db = fakeDb([{ slug: 'davidson', name: 'Davidson Data', place_name: null, description: '', county_fips: '47037' }]);
  const { log, warnings } = quietLog();
  const communities = await loadCommunities({
    vocabulary,
    dir: filesDir({ 'knox-county.md': knoxFile }),
    env: { NETLIFY_DB_URL: 'postgres://db' },
    log,
    connect: db.connect,
  });
  assert.deepEqual(communities, [
    { slug: 'davidson', name: 'Davidson Data', county_fips: '47037', county: 'Davidson County', state_code: 'TN', state_name: 'Tennessee' },
  ]);
  assert.match(db.calls[0], /WHERE approved_at IS NOT NULL/);
  assert.equal(db.closed(), true);
  assert.deepEqual(warnings, []);
});

test('without a database the build falls back to the files with a loud warning', async () => {
  const { log, warnings } = quietLog();
  const communities = await loadCommunities({ vocabulary, dir: filesDir({ 'knox-county.md': knoxFile }), env: {}, log });
  assert.equal(communities[0].slug, 'knox-county');
  assert.equal(communities[0].state_code, 'TN');
  assert.match(warnings[0], /WARNING: NETLIFY_DB_URL is not set/);
});

test('before the migrations have run, the build falls back even in production', async () => {
  assert.equal(isMissingTable(missingTable), true);
  const { log, warnings } = quietLog();
  const communities = await loadCommunities({
    vocabulary,
    dir: filesDir({ 'knox-county.md': knoxFile }),
    env: { NETLIFY_DB_URL: 'postgres://db', CONTEXT: 'production' },
    log,
    connect: fakeDb(missingTable).connect,
  });
  assert.equal(communities.length, 1);
  assert.match(warnings[0], /no communities table yet/);
});

test('a production build fails instead of publishing without its libraries', async () => {
  const { log } = quietLog();
  await assert.rejects(
    loadCommunities({
      vocabulary,
      dir: filesDir({ 'knox-county.md': knoxFile }),
      env: { NETLIFY_DB_URL: 'postgres://db', CONTEXT: 'production' },
      log,
      connect: fakeDb(new Error('connection refused')).connect,
    }),
    /Could not read community libraries from Netlify Database: connection refused/
  );
});

test('a deploy preview with a broken database falls back with a warning', async () => {
  const { log, warnings } = quietLog();
  const communities = await loadCommunities({
    vocabulary,
    dir: filesDir({ 'knox-county.md': knoxFile }),
    env: { NETLIFY_DB_URL: 'postgres://db', CONTEXT: 'deploy-preview' },
    log,
    connect: fakeDb(new Error('timeout')).connect,
  });
  assert.equal(communities.length, 1);
  assert.match(warnings[0], /Could not read community libraries from Netlify Database \(timeout\)/);
});

test('a county FIPS code missing from the vocabulary fails the build', async () => {
  const { log } = quietLog();
  await assert.rejects(
    loadCommunities({
      vocabulary,
      dir: filesDir({}),
      env: { NETLIFY_DB_URL: 'postgres://db' },
      log,
      connect: fakeDb([{ slug: 'old-ct', name: 'Old CT', county_fips: '09001' }]).connect,
    }),
    /old-ct \(09001\)/
  );
});
