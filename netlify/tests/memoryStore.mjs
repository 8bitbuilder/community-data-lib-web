// Minimal stand-in for a @netlify/blobs store: get(key, { type: 'json' }) and setJSON(key, value).
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value) { data.set(key, structuredClone(value)); },
  };
}
