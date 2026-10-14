const canonical = (v) => {
  if (Array.isArray(v)) return JSON.stringify([...v].map((x) => JSON.stringify(x)).sort());
  if (v && typeof v === 'object') return JSON.stringify(Object.keys(v).sort().map((k) => [k, v[k]]));
  return JSON.stringify(v);
};
const same = (a, b) => canonical(a) === canonical(b);
const text = (v) => (v == null ? '' : v);

/** Fields the editor changed, in the shape metadata-edit expects. */
export function diffFields(original, edited) {
  const out = {};
  for (const [field, value] of Object.entries(edited)) {
    if (field === 'provider') {
      const changed = Object.fromEntries(
        Object.entries(value).filter(([k, v]) => text(v) !== text(original.provider?.[k])),
      );
      if (Object.keys(changed).length) out.provider = changed;
    } else if (field === 'download') {
      if (text(value.url) !== text(original.download?.url)) out.download = { url: value.url };
    } else if (typeof value === 'string') {
      if (value !== text(original[field])) out[field] = value;
    } else if (!same(value, original[field])) {
      out[field] = value;
    }
  }
  return out;
}
