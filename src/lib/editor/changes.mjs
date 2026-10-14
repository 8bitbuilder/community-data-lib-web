const same = (a, b) =>
  JSON.stringify(Array.isArray(a) ? [...a].sort() : a) === JSON.stringify(Array.isArray(b) ? [...b].sort() : b);

/** Fields the editor changed, in the shape metadata-edit expects. */
export function diffFields(original, edited) {
  const out = {};
  for (const [field, value] of Object.entries(edited)) {
    if (field === 'provider') {
      const changed = Object.fromEntries(Object.entries(value).filter(([k, v]) => v !== original.provider?.[k]));
      if (Object.keys(changed).length) out.provider = changed;
    } else if (field === 'download') {
      if (value.url !== original.download?.url) out.download = { url: value.url };
    } else if (!same(value, original[field])) {
      out[field] = value;
    }
  }
  return out;
}
