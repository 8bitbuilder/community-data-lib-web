import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLibrarianHandler, maskEmail } from '../netlify/lib/librarianApi.mjs';
import { ConflictError, createGitHubCommunityStore } from '../netlify/lib/githubCommunityStore.mjs';
import { createLibrarianStore } from '../netlify/lib/librarianStore.mjs';
import { createIdentityVerifier } from '../netlify/lib/identity.mjs';
import librarianFunction, { config } from '../netlify/functions/librarian-api.mjs';

type Community = Record<string, unknown> & { slug: string; name: string };
type Pull = { number: number; state: string; merged: boolean; community: Community; title: string; body: string };

const knox: Community = {
  name: 'Knox County Data Library',
  slug: 'knox-county',
  state_code: 'TN',
  county_fips: '47093',
  zip_codes: ['37901'],
};

/** In-memory stand-in for the GitHub store: main-branch files plus pull requests. */
function fakeGitHub(initial: Community[]) {
  const files = new Map(initial.map((c) => [c.slug, { community: c, body: 'Body', sha: `${c.slug}-1` }]));
  const pulls: Pull[] = [];
  const commits: string[] = [];
  return {
    files,
    pulls,
    commits,
    async list() {
      return [...files.values()];
    },
    async get(slug: string) {
      return files.get(slug) ?? null;
    },
    async update(community: Community, body: string, sha: string, message: string) {
      if (files.get(community.slug)?.sha !== sha) throw new ConflictError('stale');
      files.set(community.slug, { community, body, sha: `${community.slug}-2` });
      commits.push(message);
    },
    async proposeNew(community: Community, { title, body }: { title: string; body: string }) {
      if (pulls.some((p) => p.community.slug === community.slug && p.state === 'open')) throw new ConflictError('branch exists');
      const pull = { number: pulls.length + 1, state: 'open', merged: false, community, title, body };
      pulls.push(pull);
      return { number: pull.number, url: `https://github.example/pull/${pull.number}` };
    },
    async getPullRequest(number: number) {
      const pull = pulls.find((p) => p.number === number);
      return pull ? { state: pull.state, merged: pull.merged } : null;
    },
    /** Simulate the team merging (approving) a pull request. */
    merge(number: number) {
      const pull = pulls.find((p) => p.number === number)!;
      Object.assign(pull, { state: 'closed', merged: true });
      files.set(pull.community.slug, { community: pull.community, body: '', sha: `${pull.community.slug}-1` });
    },
  };
}

/** In-memory Netlify Blobs store with the methods the librarian store uses. */
function fakeBlobs(initial: Record<string, unknown> = {}) {
  const data = new Map(Object.entries(initial).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    async get(key: string) {
      return data.has(key) ? JSON.parse(data.get(key)!) : null;
    },
    async setJSON(key: string, value: unknown) {
      data.set(key, JSON.stringify(value));
    },
    async delete(key: string) {
      data.delete(key);
    },
    async list() {
      return { blobs: [...data.keys()].map((key) => ({ key })) };
    },
  };
}

const knoxRecord = { emails: ['librarian@knoxdata.org'], status: 'approved', name: knox.name, county_fips: '47093' };

// Tokens map straight to emails; anything else is "not logged in".
const verifyUser = async (request: Request) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  return token ? { email: token } : null;
};

function setup() {
  const github = fakeGitHub([knox]);
  const blobs = fakeBlobs({ 'knox-county': knoxRecord });
  const handle = createLibrarianHandler({
    verifyUser,
    github,
    librarians: createLibrarianStore(blobs),
    now: () => '2026-10-14T00:00:00Z',
  });
  return { github, blobs, handle };
}

function call(handle: (r: Request) => Promise<Response>, method: string, path: string, email?: string, body?: unknown) {
  return handle(
    new Request(`https://cdl.example${path}`, {
      method,
      headers: email ? { Authorization: `Bearer ${email}` } : {},
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

const davidson = {
  name: 'Davidson County Data Library',
  state_code: 'TN',
  county_fips: '47037',
  zip_codes: ['37201'],
};

test('requests without a login are rejected', async () => {
  const { handle } = setup();
  assert.equal((await call(handle, 'GET', '/api/librarian/libraries')).status, 401);
});

test('a librarian sees only the libraries they maintain', async () => {
  const { handle, blobs } = setup();
  await blobs.setJSON('other', { ...knoxRecord, emails: ['x@y.org'], name: 'Other' });
  const res = await call(handle, 'GET', '/api/librarian/libraries', 'librarian@knoxdata.org');
  const body = await res.json();
  assert.deepEqual(body.libraries.map((l: { slug: string; status: string }) => [l.slug, l.status]), [['knox-county', 'approved']]);
  assert.deepEqual(body.libraries[0].librarians, ['librarian@knoxdata.org']);
});

test('registering opens a pull request for approval and keeps the email private', async () => {
  const { handle, github, blobs } = setup();
  const res = await call(handle, 'POST', '/api/librarian/libraries', 'jane.doe@utk.edu', davidson);
  assert.equal(res.status, 202);
  assert.equal((await res.json()).status, 'pending');

  assert.equal(github.files.has('davidson-county-data-library'), false, 'not live before approval');
  const [pull] = github.pulls;
  assert.match(pull.title, /Davidson County Data Library/);
  assert.match(pull.body, /j\*\*\*@utk\.edu/);
  assert.doesNotMatch(pull.body + JSON.stringify(pull.community), /jane\.doe/);

  const record = JSON.parse(blobs.data.get('davidson-county-data-library')!);
  assert.deepEqual(record.emails, ['jane.doe@utk.edu']);
  assert.equal(record.status, 'pending');
  assert.equal(record.pull_request, 1);
});

test('a pending library blocks duplicates and cannot be edited until approved', async () => {
  const { handle, github } = setup();
  await call(handle, 'POST', '/api/librarian/libraries', 'jane@utk.edu', davidson);

  const dup = await call(handle, 'POST', '/api/librarian/libraries', 'other@utk.edu', { ...davidson, name: 'Nashville Data' });
  assert.equal(dup.status, 409);
  assert.match((await dup.json()).errors[0].message, /awaiting approval/);

  const early = await call(handle, 'PUT', '/api/librarian/libraries/davidson-county-data-library', 'jane@utk.edu', davidson);
  assert.equal(early.status, 409);

  github.merge(1);
  const list = await (await call(handle, 'GET', '/api/librarian/libraries', 'jane@utk.edu')).json();
  assert.equal(list.libraries[0].status, 'approved');
  const edit = await call(handle, 'PUT', '/api/librarian/libraries/davidson-county-data-library', 'jane@utk.edu', {
    ...davidson,
    description: 'Now live',
  });
  assert.equal(edit.status, 200);
  assert.equal(github.files.get('davidson-county-data-library')?.community.description, 'Now live');
});

test('a rejected (closed) registration frees the county again', async () => {
  const { handle, github } = setup();
  await call(handle, 'POST', '/api/librarian/libraries', 'jane@utk.edu', davidson);
  github.pulls[0].state = 'closed';
  const again = await call(handle, 'POST', '/api/librarian/libraries', 'other@utk.edu', { ...davidson, name: 'Nashville Data' });
  assert.equal(again.status, 202);
});

test('registering a county that already has a live library returns 409 with a pointer to it', async () => {
  const { handle, github } = setup();
  const res = await call(handle, 'POST', '/api/librarian/libraries', 'new@example.org', { ...davidson, county_fips: '47093' });
  assert.equal(res.status, 409);
  assert.deepEqual((await res.json()).errors[0].existing, { slug: 'knox-county', name: knox.name, pending: false });
  assert.equal(github.pulls.length, 0);
});

test('only a library’s librarians can edit it; edits commit without emails', async () => {
  const { handle, github, blobs } = setup();
  const edit = { ...knox, description: 'Hijacked' };

  const stranger = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'x@y.org', edit);
  assert.equal(stranger.status, 403);
  assert.equal(github.files.get('knox-county')?.community.description, undefined);

  const owner = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'librarian@knoxdata.org', {
    ...edit,
    description: 'Updated',
    librarian_emails: ['librarian@knoxdata.org', 'teacher@school.edu'],
  });
  assert.equal(owner.status, 200);
  const saved = github.files.get('knox-county');
  assert.equal(saved?.community.description, 'Updated');
  assert.equal(saved?.body, 'Body');
  assert.equal('librarian_emails' in (saved?.community ?? {}), false);
  assert.doesNotMatch(github.commits.join(' '), /@/);
  assert.deepEqual(JSON.parse(blobs.data.get('knox-county')!).emails, ['librarian@knoxdata.org', 'teacher@school.edu']);
});

test('changing only librarians updates Blobs without a commit', async () => {
  const { handle, github } = setup();
  const res = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'librarian@knoxdata.org', {
    ...knox,
    librarian_emails: ['librarian@knoxdata.org', 'teacher@school.edu'],
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).published, false);
  assert.equal(github.commits.length, 0);
});

test('removing the last librarian returns 400 and saves nothing', async () => {
  const { handle, github, blobs } = setup();
  const res = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'librarian@knoxdata.org', {
    ...knox,
    librarian_emails: [],
  });
  assert.equal(res.status, 400);
  assert.equal(github.files.get('knox-county')?.sha, 'knox-county-1');
  assert.deepEqual(JSON.parse(blobs.data.get('knox-county')!).emails, ['librarian@knoxdata.org']);
});

test('if opening the pull request fails, the slug is released', async () => {
  const { handle, github, blobs } = setup();
  github.proposeNew = async () => {
    throw new Error('GitHub is down');
  };
  const res = await call(handle, 'POST', '/api/librarian/libraries', 'jane@utk.edu', davidson);
  assert.equal(res.status, 502);
  assert.equal(blobs.data.has('davidson-county-data-library'), false);
});

test('unknown libraries, bad bodies, and stale writes get clear errors', async () => {
  const { handle, github } = setup();
  const owner = 'librarian@knoxdata.org';

  assert.equal((await call(handle, 'PUT', '/api/librarian/libraries/nowhere', owner, knox)).status, 403);
  assert.equal((await call(handle, 'PUT', '/api/librarian/libraries/..%2F..%2Fnetlify', owner, knox)).status, 403);
  assert.equal((await call(handle, 'POST', '/api/librarian/libraries', owner, '"text"')).status, 400);
  assert.equal((await call(handle, 'DELETE', '/api/librarian/libraries/knox-county', owner)).status, 405);

  github.update = async () => {
    throw new ConflictError('stale');
  };
  const stale = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', owner, { ...knox, description: 'x' });
  assert.equal(stale.status, 409);
});

test('without a GitHub token the function reports it is not configured', async () => {
  assert.deepEqual(config.path, ['/api/librarian/libraries', '/api/librarian/libraries/*']);
  const res = await librarianFunction(new Request('https://cdl.example/api/librarian/libraries'));
  assert.equal(res.status, 503);
});

test('emails are masked for reviewers', () => {
  assert.equal(maskEmail('jane.doe@utk.edu'), 'j***@utk.edu');
});

test('the identity verifier accepts only confirmed users', async () => {
  const fakeFetch = async (url: string, init: RequestInit) => {
    assert.equal(url, 'https://cdl.example/.netlify/identity/user');
    const token = (init.headers as Record<string, string>).Authorization;
    if (token === 'Bearer good') return Response.json({ email: 'Lib@Example.org', confirmed_at: '2026-10-01' });
    if (token === 'Bearer unconfirmed') return Response.json({ email: 'x@example.org', confirmed_at: null });
    return new Response('', { status: 401 });
  };
  const verify = createIdentityVerifier({ fetch: fakeFetch as typeof fetch });
  const req = (auth?: string) =>
    new Request('https://cdl.example/api/librarian/libraries', { headers: auth ? { Authorization: auth } : {} });

  assert.deepEqual(await verify(req('Bearer good')), { email: 'lib@example.org' });
  assert.equal(await verify(req('Bearer unconfirmed')), null);
  assert.equal(await verify(req('Bearer expired')), null);
  assert.equal(await verify(req()), null);

  const remote = createIdentityVerifier({
    identityUrl: 'https://cdl.example/.netlify/identity/',
    fetch: fakeFetch as typeof fetch,
  });
  const local = new Request('http://localhost:8888/api/librarian/libraries', { headers: { Authorization: 'Bearer good' } });
  assert.deepEqual(await remote(local), { email: 'lib@example.org' });
});

test('the GitHub store commits edits and proposes new libraries as pull requests', async () => {
  const calls: { url: string; method: string; body?: Record<string, unknown> }[] = [];
  const markdown = '---\nname: Knox\nslug: knox-county\nstate_code: TN\ncounty_fips: "47093"\n---\n\nBody\n';
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (method === 'PUT') return Response.json({}, { status: 201 });
    if (url.endsWith('/git/ref/heads/main')) return Response.json({ object: { sha: 'main-sha' } });
    if (url.endsWith('/git/refs')) return Response.json({}, { status: 201 });
    if (url.endsWith('/pulls')) return Response.json({ number: 7, html_url: 'https://github.com/org/web/pull/7' }, { status: 201 });
    if (url.endsWith('/pulls/7')) return Response.json({ state: 'closed', merged: true });
    if (url.includes('/contents/src/content/communities?')) {
      return Response.json([{ type: 'file', name: 'knox-county.md', path: 'src/content/communities/knox-county.md' }]);
    }
    return Response.json({ sha: 'abc', content: Buffer.from(markdown).toString('base64') });
  };
  const store = createGitHubCommunityStore({ token: 't', repo: 'org/web', fetch: fakeFetch as typeof fetch });
  const api = 'https://api.github.com/repos/org/web';

  const [entry] = await store.list();
  assert.equal(entry.sha, 'abc');
  await store.update({ ...entry.community, description: 'New' }, entry.body, entry.sha, 'msg');
  const put = calls.at(-1)!;
  assert.equal(put.url, `${api}/contents/src/content/communities/knox-county.md`);
  assert.deepEqual([put.body?.sha, put.body?.branch], ['abc', 'main']);
  assert.match(Buffer.from(String(put.body!.content), 'base64').toString(), /description: New/);

  calls.length = 0;
  const pull = await store.proposeNew(
    { name: 'Davidson', slug: 'davidson', state_code: 'TN', county_fips: '47037', zip_codes: [] },
    { message: 'Register', title: 'New library', body: 'Details' },
  );
  assert.deepEqual(pull, { number: 7, url: 'https://github.com/org/web/pull/7' });
  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url.replace(api, '')}`),
    ['GET /git/ref/heads/main', 'POST /git/refs', 'PUT /contents/src/content/communities/davidson.md', 'POST /pulls'],
  );
  assert.deepEqual(calls[1].body, { ref: 'refs/heads/library/davidson', sha: 'main-sha' });
  assert.equal(calls[2].body?.branch, 'library/davidson');
  assert.deepEqual(await store.getPullRequest(7), { state: 'closed', merged: true });
});
