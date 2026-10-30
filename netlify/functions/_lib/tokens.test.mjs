import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signToken, verifyToken, newNonce } from './tokens.mjs';

const SECRET = 'x'.repeat(32);
const NOW = 1_800_000_000_000;

test('round-trips a valid token', () => {
  const token = signToken({ email: 'a@b.org', exp: NOW + 1000, purpose: 'link' }, SECRET);
  assert.deepEqual(verifyToken(token, SECRET, { purpose: 'link', now: NOW }).payload.email, 'a@b.org');
});

test('rejects expired tokens as expired', () => {
  const token = signToken({ email: 'a@b.org', exp: NOW, purpose: 'link' }, SECRET);
  assert.deepEqual(verifyToken(token, SECRET, { purpose: 'link', now: NOW }), { error: 'expired' });
});

test('rejects wrong purpose, tampering, wrong secret, and garbage as invalid', () => {
  const token = signToken({ email: 'a@b.org', exp: NOW + 1000, purpose: 'link' }, SECRET);
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'evil@x.org', exp: NOW + 1000, purpose: 'link' })).toString('base64url');
  for (const [t, secret, purpose] of [
    [token, SECRET, 'session'],
    [`${forged}.${sig}`, SECRET, 'link'],
    [token, 'y'.repeat(32), 'link'],
    [`${body}.${sig}.extra`, SECRET, 'link'],
    ['not-a-token', SECRET, 'link'],
    [null, SECRET, 'link'],
  ]) {
    assert.deepEqual(verifyToken(t, secret, { purpose, now: NOW }), { error: 'invalid' });
  }
});

test('nonces are random and URL-safe', () => {
  const a = newNonce();
  assert.match(a, /^[A-Za-z0-9_-]{22}$/);
  assert.notEqual(a, newNonce());
});
