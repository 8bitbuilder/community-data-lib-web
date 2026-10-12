import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createLibrarianHandler } from '../netlify/lib/librarianApi.mjs';
import { ConflictError, createGitHubCommunityStore } from '../netlify/lib/githubCommunityStore.mjs';
import { createIdentityVerifier } from '../netlify/lib/identity.mjs';
import librarianFunction, { config } from '../netlify/functions/librarian-api.mjs';

type Community = Record<string, unknown> & { slug: string };

const knox: Community = {
  name: 'Knox County Data Library',
  slug: 'knox-county',
  state_code: 'TN',
  county_fips: '47093',
  zip_codes: ['37901'],
  librarian_emails: ['librarian@knoxdata.org'],
};

/** In-memory stand-in for the GitHub store, with the same SHA conflict behavior. */
function memoryStore(initial: Community[]) {
  const files = new Map(initial.map((c) => [c.slug, { community: c, body: 'Body', sha: `${c.slug}-1` }]));
  return {
    files,
    async list() {
      return [...files.values()];
    },
    async get(slug: string) {
      return files.get(slug) ?? null;
    },
    async create(community: Community) {
      if (files.has(community.slug)) throw new ConflictError('exists');
      files.set(community.slug, { community, body: '', sha: `${community.slug}-1` });
    },
    async update(community: Community, body: string, sha: string) {
      if (files.get(community.slug)?.sha !== sha) throw new ConflictError('stale');
      files.set(community.slug, { community, body, sha: `${community.slug}-2` });
    },
  };
}

// Tokens map straight to emails; anything else is "not logged in".
const verifyUser = async (request: Request) => {
  const token = request.headers.get('authorization')?.replace('Bearer ', '');
  return token ? { email: token } : null;
};

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
  const handle = createLibrarianHandler({ verifyUser, store: memoryStore([knox]) });
  const res = await call(handle, 'GET', '/api/librarian/libraries');
  assert.equal(res.status, 401);
});

test('a librarian sees only the libraries they maintain', async () => {
  const other = { ...knox, slug: 'other', county_fips: '47037', librarian_emails: ['x@y.org'] };
  const handle = createLibrarianHandler({ verifyUser, store: memoryStore([knox, other]) });
  const res = await call(handle, 'GET', '/api/librarian/libraries', 'librarian@knoxdata.org');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.libraries.map((l: Community) => l.slug), ['knox-county']);
});

test('registering creates the file with the registrant as librarian', async () => {
  const store = memoryStore([knox]);
  const handle = createLibrarianHandler({ verifyUser, store });
  const res = await call(handle, 'POST', '/api/librarian/libraries', 'new@example.org', davidson);
  assert.equal(res.status, 201);
  const saved = store.files.get('davidson-county-data-library')?.community;
  assert.deepEqual(saved?.librarian_emails, ['new@example.org']);
});

test('registering a county that already has a library returns 409', async () => {
  const store = memoryStore([knox]);
  const handle = createLibrarianHandler({ verifyUser, store });
  const res = await call(handle, 'POST', '/api/librarian/libraries', 'new@example.org', {
    ...davidson,
    county_fips: '47093',
  });
  assert.equal(res.status, 409);
  assert.equal(store.files.size, 1);
});

test('only a library’s librarians can edit it', async () => {
  const store = memoryStore([knox]);
  const handle = createLibrarianHandler({ verifyUser, store });
  const edit = { ...knox, description: 'Hijacked' };

  const stranger = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'x@y.org', edit);
  assert.equal(stranger.status, 403);
  assert.equal(store.files.get('knox-county')?.community.description, undefined);

  const owner = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'librarian@knoxdata.org', {
    ...edit,
    description: 'Updated',
    librarian_emails: ['librarian@knoxdata.org', 'teacher@school.edu'],
  });
  assert.equal(owner.status, 200);
  const saved = store.files.get('knox-county');
  assert.equal(saved?.community.description, 'Updated');
  assert.deepEqual(saved?.community.librarian_emails, ['librarian@knoxdata.org', 'teacher@school.edu']);
  assert.equal(saved?.body, 'Body');
});

test('removing the last librarian returns 400 and saves nothing', async () => {
  const store = memoryStore([knox]);
  const handle = createLibrarianHandler({ verifyUser, store });
  const res = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', 'librarian@knoxdata.org', {
    ...knox,
    librarian_emails: [],
  });
  assert.equal(res.status, 400);
  assert.equal(store.files.get('knox-county')?.sha, 'knox-county-1');
});

test('unknown libraries, bad bodies, and stale writes get clear errors', async () => {
  const store = memoryStore([knox]);
  const handle = createLibrarianHandler({ verifyUser, store });
  const owner = 'librarian@knoxdata.org';

  assert.equal((await call(handle, 'PUT', '/api/librarian/libraries/nowhere', owner, knox)).status, 404);
  assert.equal((await call(handle, 'PUT', '/api/librarian/libraries/..%2F..%2Fnetlify', owner, knox)).status, 404);
  assert.equal((await call(handle, 'POST', '/api/librarian/libraries', owner, '"text"')).status, 400);
  assert.equal((await call(handle, 'DELETE', '/api/librarian/libraries/knox-county', owner)).status, 405);

  store.update = async () => {
    throw new ConflictError('stale');
  };
  const stale = await call(handle, 'PUT', '/api/librarian/libraries/knox-county', owner, knox);
  assert.equal(stale.status, 409);
});

test('without a GitHub token the function reports it is not configured', async () => {
  assert.deepEqual(config.path, ['/api/librarian/libraries', '/api/librarian/libraries/*']);
  const res = await librarianFunction(new Request('https://cdl.example/api/librarian/libraries'));
  assert.equal(res.status, 503);
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
});

test('the GitHub store commits community files through the contents API', async () => {
  const calls: { url: string; method: string; body?: Record<string, string> }[] = [];
  const markdown = '---\nname: Knox\nslug: knox-county\nstate_code: TN\ncounty_fips: "47093"\nlibrarian_emails:\n  - a@b.org\n---\n\nBody\n';
  const fakeFetch = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? 'GET', body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (init.method === 'PUT') return Response.json({}, { status: 201 });
    if (url.includes('/contents/src/content/communities?')) {
      return Response.json([{ type: 'file', name: 'knox-county.md', path: 'src/content/communities/knox-county.md' }]);
    }
    return Response.json({ sha: 'abc', content: Buffer.from(markdown).toString('base64') });
  };
  const store = createGitHubCommunityStore({ token: 't', repo: 'org/web', fetch: fakeFetch as typeof fetch });

  const [entry] = await store.list();
  assert.equal(entry.sha, 'abc');
  assert.equal(entry.community.county_fips, '47093');

  await store.update({ ...entry.community, description: 'New' }, entry.body, entry.sha, 'msg');
  const put = calls.at(-1)!;
  assert.equal(put.url, 'https://api.github.com/repos/org/web/contents/src/content/communities/knox-county.md');
  assert.equal(put.body?.sha, 'abc');
  assert.equal(put.body?.branch, 'main');
  assert.match(Buffer.from(put.body!.content, 'base64').toString(), /description: New/);
});
