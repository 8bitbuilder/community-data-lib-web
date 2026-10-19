import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sessionCookie, clearSessionCookie, readCookie, requireEditor, SESSION_COOKIE } from './session.mjs';
import { signToken } from './tokens.mjs';

const config = { authSecret: 's'.repeat(32), editorEmails: 'alice@example.org', siteOrigin: 'https://cdl.example' };
const NOW = 1_800_000_000_000;

const cookieValue = (setCookie) => setCookie.split(';')[0];
const req = (method, { cookie, origin } = {}) =>
  new Request('https://cdl.example/.netlify/functions/x', {
    method,
    headers: { ...(cookie ? { cookie } : {}), ...(origin ? { origin } : {}) },
  });

test('session cookie has the required attributes', () => {
  const c = sessionCookie('alice@example.org', config.authSecret, NOW);
  assert.match(c, /^cdl_session=[^;]+; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800$/);
  assert.match(clearSessionCookie(), /^cdl_session=; .*Max-Age=0$/);
});

test('readCookie finds the cookie among others', () => {
  const r = req('GET', { cookie: `a=1; ${SESSION_COOKIE}=abc.def; b=2` });
  assert.equal(readCookie(r, SESSION_COOKIE), 'abc.def');
  assert.equal(readCookie(req('GET'), SESSION_COOKIE), null);
});

test('requireEditor accepts a valid session', () => {
  const cookie = cookieValue(sessionCookie('alice@example.org', config.authSecret, NOW));
  assert.equal(requireEditor(req('GET', { cookie }), config, NOW), 'alice@example.org');
  assert.equal(requireEditor(req('POST', { cookie, origin: 'https://cdl.example' }), config, NOW), 'alice@example.org');
});

test('requireEditor rejects missing, expired, and link-purpose tokens with 401', () => {
  const expired = cookieValue(sessionCookie('alice@example.org', config.authSecret, NOW - 8 * 864e5));
  const linkToken = signToken({ email: 'alice@example.org', exp: NOW + 1000, purpose: 'link' }, config.authSecret);
  for (const cookie of [undefined, expired, `${SESSION_COOKIE}=${linkToken}`]) {
    assert.throws(() => requireEditor(req('GET', { cookie }), config, NOW), (e) => e.status === 401);
  }
});

test('requireEditor rejects revoked emails with 403', () => {
  const cookie = cookieValue(sessionCookie('alice@example.org', config.authSecret, NOW));
  const revoked = { ...config, editorEmails: 'bob@example.org' };
  assert.throws(() => requireEditor(req('GET', { cookie }), revoked, NOW), (e) => e.status === 403 && /removed/.test(e.message));
});

test('requireEditor rejects POSTs from another origin with 403', () => {
  const cookie = cookieValue(sessionCookie('alice@example.org', config.authSecret, NOW));
  for (const origin of [undefined, 'https://evil.example']) {
    assert.throws(() => requireEditor(req('POST', { cookie, origin }), config, NOW), (e) => e.status === 403 && /origin/i.test(e.message));
  }
});
