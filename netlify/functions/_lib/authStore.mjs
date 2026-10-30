export async function getAuthStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'cdl-auth', consistency: 'strong' });
}

export async function consumeNonce(store, nonce, exp) {
  const key = `nonce/${nonce}`;
  const result = await store.setJSON(key, { exp }, { onlyIfNew: true });
  return result.modified;
}

export async function hitRateLimit(store, key, { limit, windowMs }, now = Date.now()) {
  const storeKey = `rate/${key}`;
  const current = await store.get(storeKey, { type: 'json' });
  const entry = current && now - current.start < windowMs ? current : { start: now, count: 0 };
  entry.count += 1;
  await store.setJSON(storeKey, entry);
  return entry.count > limit;
}
