import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, isAllowed, isValidEmail } from './allowlist.mjs';

test('normalizes case and whitespace on both sides', () => {
  const list = ' Alice@Example.ORG , bob@cdl.org ,,';
  assert.equal(isAllowed('  alice@example.org ', list), true);
  assert.equal(isAllowed('ALICE@EXAMPLE.ORG', list), true);
  assert.equal(isAllowed('bob@cdl.org', list), true);
});

test('rejects unknown, empty, and non-string emails', () => {
  assert.equal(isAllowed('carol@cdl.org', 'alice@example.org'), false);
  assert.equal(isAllowed('', 'alice@example.org,'), false);
  assert.equal(isAllowed(undefined, 'alice@example.org'), false);
  assert.equal(normalizeEmail(42), '');
});

test('validates email shape and length', () => {
  assert.equal(isValidEmail('a@b.org'), true);
  assert.equal(isValidEmail('no-at-sign'), false);
  assert.equal(isValidEmail('a b@c.org'), false);
  assert.equal(isValidEmail(`${'a'.repeat(250)}@b.org`), false);
});
