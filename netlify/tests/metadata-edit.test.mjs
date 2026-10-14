import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../functions/metadata-edit.mjs';
import { GitHubError } from '../functions/_lib/github.mjs';
import { sessionCookie } from '../functions/_lib/session.mjs';
import { readYaml } from '../functions/_lib/yamlEdit.mjs';

const ORIGIN = 'https://cdl.example';
const config = { authSecret: 's'.repeat(32), editorEmails: 'alice@example.org', siteOrigin: ORIGIN };
const NOW = Date.UTC(2026, 9, 14, 15, 30, 0);
const COOKIE = sessionCookie('alice@example.org', config.authSecret, NOW).split(';')[0];
const VOCAB = `description_tags:
- Agriculture
- Population Data
statistical_tags:
  anova_tags:
  - good-for-one-way-anova
  - good-for-two-way-anova
`;
const DATASET = `id: usda-milk
title: Milk Production
notes: null
provider:
  name: USDA
  url: https://usda.gov
description_tags:
- Agriculture
when: '2025'
`;

function fakeGitHub(files = { 'data/sources/usda-milk.yml': DATASET, 'data/tag_vocabulary.yml': VOCAB }, { failPut = false } = {}) {
  const calls = [];
  return {
    calls,
    files,
    async getHeadSha() { calls.push(['getHeadSha']); return 'head123'; },
    async getFile(path, ref) { calls.push(['getFile', path, ref]); return path in files ? { text: files[path], sha: `sha-${path}` } : null; },
    async createBranch(name, sha) { calls.push(['createBranch', name, sha]); },
    async deleteBranch(name) { calls.push(['deleteBranch', name]); },
    async putFile(path, opts) { calls.push(['putFile', path, opts]); if (failPut) throw new Error('409'); },
    async openPullRequest(opts) { calls.push(['openPullRequest', opts]); return { number: 7, html_url: 'https://github.com/x/pull/7' }; },
    async listOpenPullRequests(prefix) { calls.push(['list', prefix]); return [{ number: 3, url: 'u', title: 't' }]; },
  };
}

// Silence handler logging during tests
const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
test.before(() => {
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});
test.after(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

const get = (id, cookie = COOKIE) => new Request(`${ORIGIN}/.netlify/functions/metadata-edit?id=${id}`, { headers: cookie ? { cookie } : {} });
const post = (body, { cookie = COOKIE, origin = ORIGIN } = {}) =>
  new Request(`${ORIGIN}/.netlify/functions/metadata-edit`, {
    method: 'POST',
    headers: { cookie, origin, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

test('GET returns editable fields, vocabulary, manual tags, and open PRs', async () => {
  const github = fakeGitHub();
  const res = await createHandler({ config, github, now: () => NOW })(get('usda-milk'));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.fields.title, 'Milk Production');
  assert.deepEqual(body.fields.anova_tags, { 'good-for-one-way-anova': false, 'good-for-two-way-anova': false });
  assert.deepEqual(body.vocabulary.description_tags, ['Agriculture', 'Population Data']);
  assert.deepEqual(body.manualTags, []);
  assert.deepEqual(body.openPullRequests, [{ number: 3, url: 'u', title: 't' }]);
  assert.deepEqual(github.calls.find((c) => c[0] === 'list'), ['list', 'metadata/usda-milk-']);
});

test('requires a session and a safe id', async () => {
  const handler = createHandler({ config, github: fakeGitHub(), now: () => NOW });
  assert.equal((await handler(get('usda-milk', null))).status, 401);
  for (const id of ['..%2Fsecrets', 'Bad_ID', '']) assert.equal((await handler(get(id))).status, 400, id);
  assert.equal((await handler(get('missing'))).status, 404);
});

test('POST opens a PR containing only the changed lines', async () => {
  const github = fakeGitHub();
  const res = await createHandler({ config, github, now: () => NOW })(
    post({ id: 'usda-milk', changes: { title: 'yes', anova_tags: { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false } } }),
  );
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { prUrl: 'https://github.com/x/pull/7', prNumber: 7 });

  const branch = 'metadata/usda-milk-20261014T153000Z';
  assert.deepEqual(github.calls.find((c) => c[0] === 'createBranch'), ['createBranch', branch, 'head123']);
  const [, path, put] = github.calls.find((c) => c[0] === 'putFile');
  assert.equal(path, 'data/sources/usda-milk.yml');
  assert.equal(put.branch, branch);
  assert.equal(put.sha, 'sha-data/sources/usda-milk.yml');
  assert.match(put.message, /^Update metadata for usda-milk\n\nCo-Authored-By: alice@example.org <alice@example.org>$/);
  const written = readYaml(put.text);
  assert.equal(written.title, 'yes');
  assert.deepEqual(written.manual_tags, ['anova_tags']);
  assert.equal(written.when, '2025');
  assert.ok(put.text.startsWith('id: usda-milk\ntitle: "yes"\nnotes: null\n'));

  const [, pr] = github.calls.find((c) => c[0] === 'openPullRequest');
  assert.equal(pr.title, 'Update metadata: Milk Production (by alice@example.org)');
  assert.equal(pr.head, branch);
  assert.match(pr.body, /\| `title` \| Milk Production \| yes \|/);
});

test('POST applies only submitted fields onto the latest main content', async () => {
  // Simulates main having changed after the form loaded: notes is new on main.
  const github = fakeGitHub({ 'data/sources/usda-milk.yml': DATASET.replace('notes: null', 'notes: Newer note'), 'data/tag_vocabulary.yml': VOCAB });
  await createHandler({ config, github, now: () => NOW })(post({ id: 'usda-milk', changes: { title: 'New' } }));
  const [, , put] = github.calls.find((c) => c[0] === 'putFile');
  assert.equal(readYaml(put.text).notes, 'Newer note');
  assert.deepEqual(github.calls.filter((c) => c[0] === 'getFile').map((c) => c[2]), ['head123', 'head123']);
});

test('POST rejects no-op edits, invalid fields, bad origin', async () => {
  const handler = createHandler({ config, github: fakeGitHub(), now: () => NOW });
  assert.equal((await handler(post({ id: 'usda-milk', changes: { title: 'Milk Production' } }))).status, 400);
  const bad = await handler(post({ id: 'usda-milk', changes: { description_tags: ['Nope'] } }));
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).field, 'description_tags');
  assert.equal((await handler(post({ id: 'usda-milk', changes: { title: 'x' } }, { origin: 'https://evil.example' }))).status, 403);
});

test('POST cleans up the branch when GitHub fails', async () => {
  const github = fakeGitHub(undefined, { failPut: true });
  const res = await createHandler({ config, github, now: () => NOW })(post({ id: 'usda-milk', changes: { title: 'New' } }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /nothing was saved/);
  assert.deepEqual(github.calls.at(-1), ['deleteBranch', 'metadata/usda-milk-20261014T153000Z']);
});

test('GET returns 502 when GitHub fails', async () => {
  const github = {
    calls: [],
    async getHeadSha() { throw new GitHubError('GitHub error', 500); },
  };
  const res = await createHandler({ config, github, now: () => NOW })(get('usda-milk'));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /GitHub is unavailable/);
});

test('POST returns 502 when getHeadSha fails', async () => {
  const github = {
    calls: [],
    async getHeadSha() { throw new GitHubError('GitHub error', 500); },
  };
  const res = await createHandler({ config, github, now: () => NOW })(post({ id: 'usda-milk', changes: { title: 'New' } }));
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /GitHub is unavailable/);
});

test('POST returns 409 when createBranch fails with 422 (conflict)', async () => {
  const github = fakeGitHub();
  const origCreateBranch = github.createBranch;
  github.createBranch = async function(name, sha) {
    github.calls.push(['createBranch', name, sha]);
    throw new GitHubError('Branch already exists', 422);
  };
  const res = await createHandler({ config, github, now: () => NOW })(post({ id: 'usda-milk', changes: { title: 'New' } }));
  assert.equal(res.status, 409);
  assert.match((await res.json()).error, /Another edit.*just submitted/);
  assert.ok(!github.calls.find((c) => c[0] === 'putFile'), 'should not call putFile');
  assert.ok(!github.calls.find((c) => c[0] === 'deleteBranch'), 'should not call deleteBranch (branch not created)');
});

test('PR body handles \\r and \\r\\n newlines in values', async () => {
  const github = fakeGitHub();
  let capturedPrBody = '';
  github.openPullRequest = async function(opts) {
    capturedPrBody = opts.body;
    return { number: 7, html_url: 'https://github.com/x/pull/7' };
  };
  const res = await createHandler({ config, github, now: () => NOW })(
    post({ id: 'usda-milk', changes: { title: 'Line1\rLine2\r\nLine3' } }),
  );
  assert.equal(res.status, 201);
  // The cell() function should replace \r and \r\n with spaces in field values
  // So "Line1\rLine2\r\nLine3" becomes "Line1 Line2 Line3" in the table
  assert.ok(capturedPrBody.includes('Line1 Line2 Line3'), 'should have replaced newlines with spaces in the value');
});

test('POST logs validation failure with field name', async () => {
  const logs = [];
  const oldLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  try {
    const handler = createHandler({ config, github: fakeGitHub(), now: () => NOW });
    const res = await handler(post({ id: 'usda-milk', changes: { description_tags: ['Invalid Tag'] } }));
    assert.equal(res.status, 400);
    const log = logs.find((l) => l.includes('post') && l.includes('usda-milk'));
    assert.ok(log, 'should log the failure');
    assert.ok(log.includes('description_tags'), 'should include field name in log');
    assert.ok(log.includes('400'), 'should include status code');
  } finally {
    console.log = oldLog;
  }
});
