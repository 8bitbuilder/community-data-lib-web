import { test } from 'node:test';
import assert from 'node:assert/strict';
import { memoryStore } from './memoryStore.mjs';
import { signToken } from '../functions/_lib/tokens.mjs';
import { sessionCookie } from '../functions/_lib/session.mjs';
import { createHandler as requestLink } from '../functions/auth-request-link.mjs';
import { createHandler as verify } from '../functions/auth-verify.mjs';
import { createHandler as me } from '../functions/auth-me.mjs';
import { createHandler as logout } from '../functions/auth-logout.mjs';

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

const ORIGIN = 'https://cdl.example';
const config = { authSecret: 's'.repeat(32), editorEmails: 'alice@example.org', siteOrigin: ORIGIN, previewPath: '/web/data-preview' };
const NOW = 1_800_000_000_000;
const now = () => NOW;
const URL_BASE = `${ORIGIN}/.netlify/functions`;

const post = (name, body, headers = {}) =>
  new Request(`${URL_BASE}/${name}`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

function setup() {
  const sent = [];
  const store = memoryStore();
  const deps = { config, store, now, sendMail: async (m) => sent.push(m) };
  return { sent, store, deps };
}

const linkToken = (email = 'alice@example.org', exp = NOW + 60_000, nonce = 'nonce-1') =>
  signToken({ email, exp, nonce, purpose: 'link' }, config.authSecret);

test('request-link: approved email gets a link and a success message', async () => {
  const { sent, deps } = setup();
  const res = await requestLink(deps)(post('auth-request-link', { email: '  ALICE@example.org ' }), { ip: '1.2.3.4' });
  assert.equal(res.status, 200);
  assert.match((await res.json()).message, /check your email/i);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'alice@example.org');
  assert.match(sent[0].link, /^https:\/\/cdl\.example\/\.netlify\/functions\/auth-verify\?token=/);
});

test('request-link: email not on the list gets an error and no link', async () => {
  const { sent, deps } = setup();
  const res = await requestLink(deps)(post('auth-request-link', { email: 'mallory@example.org' }), { ip: '1.2.3.4' });
  assert.equal(res.status, 403);
  assert.match((await res.json()).error, /isn't on the approved editor list/);
  assert.equal(sent.length, 0);
});

test('request-link: too many attempts for one email gets a 429 and no link', async () => {
  const { sent, deps } = setup();
  const handler = requestLink(deps);
  for (let i = 0; i < 3; i++) await handler(post('auth-request-link', { email: 'alice@example.org' }), { ip: '1.2.3.4' });
  const res = await handler(post('auth-request-link', { email: 'alice@example.org' }), { ip: '1.2.3.4' });
  assert.equal(res.status, 429);
  assert.match((await res.json()).error, /too many attempts/i);
  assert.equal(sent.length, 3);
});

test('request-link: unlisted emails are rate limited too, which slows probing of the list', async () => {
  const { deps } = setup();
  const handler = requestLink(deps);
  for (let i = 0; i < 20; i++) await handler(post('auth-request-link', { email: `probe${i}@example.org` }), { ip: '1.2.3.4' });
  const res = await handler(post('auth-request-link', { email: 'probe-last@example.org' }), { ip: '1.2.3.4' });
  assert.equal(res.status, 429);
});

test('request-link: rejects bad origin, bad JSON, and malformed emails', async () => {
  const handler = requestLink(setup().deps);
  assert.equal((await handler(post('auth-request-link', { email: 'a@b.org' }, { origin: 'https://evil.example' }), {})).status, 403);
  assert.equal((await handler(new Request(`${URL_BASE}/auth-request-link`, { method: 'POST', headers: { origin: ORIGIN }, body: '{' }), {})).status, 400);
  assert.equal((await handler(post('auth-request-link', { email: 'nope' }), {})).status, 400);
  assert.equal((await handler(new Request(`${URL_BASE}/auth-request-link`), {})).status, 405);
});

test('request-link: email failure returns an error, not a success message', async () => {
  const { deps } = setup();
  const handler = requestLink({ ...deps, sendMail: async () => { throw new Error('resend down'); } });
  const res = await handler(post('auth-request-link', { email: 'alice@example.org' }), {});
  assert.equal(res.status, 502);
  assert.match((await res.json()).error, /couldn't send/i);
});

test('request-link: does not reply until the email has been accepted', async () => {
  const { deps } = setup();
  let accept;
  const handler = requestLink({ ...deps, sendMail: () => new Promise((resolve) => { accept = resolve; }) });
  let replied = false;
  const pending = handler(post('auth-request-link', { email: 'alice@example.org' }), {}).then((res) => { replied = true; return res; });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(replied, false);
  accept();
  assert.equal((await pending).status, 200);
});

test('verify GET shows a confirm page and does NOT consume the link (email scanners)', async () => {
  const { store, deps } = setup();
  const handler = verify(deps);
  const token = linkToken();
  for (let i = 0; i < 3; i++) {
    const res = await handler(new Request(`${URL_BASE}/auth-verify?token=${encodeURIComponent(token)}`), {});
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const html = await res.text();
    assert.match(html, /<form method="post"/);
    assert.ok(html.includes(token));
    assert.equal(res.headers.get('referrer-policy'), 'same-origin');
  }
  assert.equal(store.data.size, 0);
});

test('verify GET response has anti-framing security headers', async () => {
  const { deps } = setup();
  const handler = verify(deps);
  const token = linkToken();
  const res = await handler(new Request(`${URL_BASE}/auth-verify?token=${encodeURIComponent(token)}`), {});
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('content-security-policy'), "frame-ancestors 'none'");
});

test('verify POST signs in once, then reports the link as used', async () => {
  const handler = verify(setup().deps);
  const form = (token) => new Request(`${URL_BASE}/auth-verify`, { method: 'POST', body: new URLSearchParams({ token }) });
  const token = linkToken();
  const first = await handler(form(token), {});
  assert.equal(first.status, 303);
  assert.equal(first.headers.get('location'), `${ORIGIN}/web/data-preview?auth=ok`);
  assert.match(first.headers.get('set-cookie'), /^cdl_session=/);
  const second = await handler(form(token), {});
  assert.equal(second.headers.get('location'), `${ORIGIN}/web/data-preview?auth=expired`);
  assert.equal(second.headers.get('set-cookie'), null);
});

test('verify redirects expired, invalid, and revoked links without a cookie', async () => {
  const handler = verify(setup().deps);
  const form = (token) => new Request(`${URL_BASE}/auth-verify`, { method: 'POST', body: new URLSearchParams({ token }) });
  const cases = [
    [linkToken('alice@example.org', NOW - 1, 'n-exp'), 'expired'],
    ['garbage', 'invalid'],
    [linkToken('bob@example.org', NOW + 60_000, 'n-bob'), 'invalid'],
  ];
  for (const [token, reason] of cases) {
    const res = await handler(form(token), {});
    assert.equal(res.headers.get('location'), `${ORIGIN}/web/data-preview?auth=${reason}`);
    assert.equal(res.headers.get('set-cookie'), null);
  }
  const get = await handler(new Request(`${URL_BASE}/auth-verify?token=garbage`), {});
  assert.equal(get.headers.get('location'), `${ORIGIN}/web/data-preview?auth=invalid`);
});

test('verify POST rejects mismatched origin and does not consume nonce', async () => {
  const { deps } = setup();
  const handler = verify(deps);
  const token = linkToken('alice@example.org', NOW + 60_000, 'nonce-reuse');
  const formWithOrigin = (t, origin) =>
    new Request(`${URL_BASE}/auth-verify`, {
      method: 'POST',
      headers: { origin },
      body: new URLSearchParams({ token: t }),
    });
  const evilRes = await handler(formWithOrigin(token, 'https://evil.example'), {});
  assert.equal(evilRes.headers.get('location'), `${ORIGIN}/web/data-preview?auth=invalid`);
  assert.equal(evilRes.headers.get('set-cookie'), null);
  const goodRes = await handler(formWithOrigin(token, ORIGIN), {});
  assert.equal(goodRes.status, 303);
  assert.equal(goodRes.headers.get('location'), `${ORIGIN}/web/data-preview?auth=ok`);
  assert.match(goodRes.headers.get('set-cookie'), /^cdl_session=/);
});

test('me returns the email for a session and 401 without one', async () => {
  const handler = me({ config, now });
  const cookie = sessionCookie('alice@example.org', config.authSecret, NOW).split(';')[0];
  const ok = await handler(new Request(`${URL_BASE}/auth-me`, { headers: { cookie } }), {});
  assert.deepEqual(await ok.json(), { email: 'alice@example.org' });
  assert.equal((await handler(new Request(`${URL_BASE}/auth-me`), {})).status, 401);
});

test('logout clears the cookie and requires same origin', async () => {
  const handler = logout({ config });
  const res = await handler(new Request(`${URL_BASE}/auth-logout`, { method: 'POST', headers: { origin: ORIGIN } }), {});
  assert.equal(res.status, 200);
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await handler(new Request(`${URL_BASE}/auth-logout`, { method: 'POST', headers: { origin: 'https://evil.example' } }), {})).status, 403);
});

test('verify POST with Origin "null" (opaque origin) signs in', async () => {
  const handler = verify(setup().deps);
  const token = linkToken('alice@example.org', NOW + 60_000, 'nonce-null-origin');
  const res = await handler(
    new Request(`${URL_BASE}/auth-verify`, { method: 'POST', headers: { origin: 'null' }, body: new URLSearchParams({ token }) }),
    {},
  );
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), `${ORIGIN}/web/data-preview?auth=ok`);
  assert.match(res.headers.get('set-cookie'), /^cdl_session=/);
});
