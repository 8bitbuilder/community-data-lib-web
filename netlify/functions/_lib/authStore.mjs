export async function getAuthStore() {
  const { getStore } = await import('@netlify/blobs');
  return getStore({ name: 'cdl-auth', consistency: 'strong' });
}

export async function consumeNonce(store, nonce, exp) {
  const key = `nonce/${nonce}`;
  if (await store.get(key, { type: 'json' })) return false;
  await store.setJSON(key, { exp });
  return true;
}

export async function hitRateLimit(store, key, { limit, windowMs }, now = Date.now()) {
  const storeKey = `rate/${key}`;
  const current = await store.get(storeKey, { type: 'json' });
  const entry = current && now - current.start < windowMs ? current : { start: now, count: 0 };
  entry.count += 1;
  await store.setJSON(storeKey, entry);
  return entry.count > limit;
}
