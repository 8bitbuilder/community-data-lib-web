import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './config.mjs';

const BASE = { AUTH_SECRET: 's'.repeat(32), EDITOR_EMAILS: 'a@b.org', SITE_ORIGIN: 'https://cdl.example/' };

test('loads config with defaults', () => {
  const c = loadConfig(BASE);
  assert.equal(c.siteOrigin, 'https://cdl.example');
  assert.equal(c.githubRepo, 'community-data-libraries/backend');
  assert.equal(c.previewPath, '/web/data-preview');
});

test('requires core variables and a long secret', () => {
  assert.throws(() => loadConfig({ ...BASE, SITE_ORIGIN: '' }), /SITE_ORIGIN/);
  assert.throws(() => loadConfig({ ...BASE, AUTH_SECRET: 'short' }), /at least 32/);
});
