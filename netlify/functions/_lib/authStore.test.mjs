import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumeNonce, hitRateLimit } from './authStore.mjs';
import { memoryStore } from '../../tests/memoryStore.mjs';

test('a nonce can be consumed once', async () => {
  const store = memoryStore();
  assert.equal(await consumeNonce(store, 'n1', 123), true);
  assert.equal(await consumeNonce(store, 'n1', 123), false);
  assert.equal(await consumeNonce(store, 'n2', 123), true);
});

test('rate limit trips after the limit and resets after the window', async () => {
  const store = memoryStore();
  const opts = { limit: 3, windowMs: 1000 };
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await hitRateLimit(store, 'k', opts, 10_000));
  assert.deepEqual(results, [false, false, false, true]);
  assert.equal(await hitRateLimit(store, 'k', opts, 11_001), false);
});
