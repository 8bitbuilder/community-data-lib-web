// Minimal stand-in for a @netlify/blobs store: get(key, { type: 'json' }) and setJSON(key, value).
export function memoryStore() {
  const data = new Map();
  return {
    data,
    async get(key) { return data.has(key) ? structuredClone(data.get(key)) : null; },
    async setJSON(key, value, opts) {
      const isNew = !data.has(key);
      if (opts?.onlyIfNew && !isNew) return { modified: false };
      data.set(key, structuredClone(value));
      return { modified: true };
    },
  };
}
