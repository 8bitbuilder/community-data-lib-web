import { HttpError } from './http.mjs';

export const TEXT_FIELDS = ['title', 'notes', 'who', 'how', 'where', 'why', 'when'];
const SUITABILITY = ['suitable', 'not_suitable', 'unreviewed'];

const fail = (field, message) => {
  throw new HttpError(400, `${field} ${message}`, field);
};
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function text(value, field, { max, required = false }) {
  if (!required && (value === null || value === '')) return null;
  if (typeof value !== 'string') fail(field, 'must be text');
  const trimmed = value.trim();
  if (trimmed === '') return required ? fail(field, 'is required') : null;
  if (trimmed.length > max) fail(field, `must be at most ${max} characters`);
  return trimmed;
}

function httpsUrl(value, field, { required }) {
  const v = text(value, field, { max: 2000, required });
  if (v === null) return null;
  let url;
  try {
    url = new URL(v);
  } catch {
    fail(field, 'must be a valid URL');
  }
  if (url.protocol !== 'https:') fail(field, 'must start with https://');
  return v;
}

const bool = (value, field) => (typeof value === 'boolean' ? value : fail(field, 'must be true or false'));

function onlyKeys(value, field, allowed) {
  if (!isPlainObject(value)) fail(field, 'must be an object');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${field}.${key}`, 'is not editable');
}

const SIMPLE = {
  title: (v, f) => text(v, f, { max: 200, required: true }),
  notes: (v, f) => text(v, f, { max: 5000 }),
  who: (v, f) => text(v, f, { max: 500 }),
  how: (v, f) => text(v, f, { max: 500 }),
  where: (v, f) => text(v, f, { max: 500 }),
  why: (v, f) => text(v, f, { max: 500 }),
  when: (v, f) => text(v, f, { max: 500 }),
  sensitive: bool,
  requires_account: bool,
  student_suitability: (v, f) => (SUITABILITY.includes(v) ? v : fail(f, `must be one of ${SUITABILITY.join(', ')}`)),
};

function validateProvider(value) {
  onlyKeys(value, 'provider', ['name', 'agency', 'url']);
  const out = {};
  if ('name' in value) out.name = text(value.name, 'provider.name', { max: 200 });
  if ('agency' in value) out.agency = text(value.agency, 'provider.agency', { max: 200 });
  if ('url' in value) out.url = httpsUrl(value.url, 'provider.url', { required: false });
  return out;
}

function validateTopicTags(value, allowed) {
  const field = 'description_tags';
  if (!Array.isArray(value)) fail(field, 'must be a list');
  for (const tag of value) if (!allowed.includes(tag)) fail(field, `has unknown tag ${JSON.stringify(tag)}`);
  if (new Set(value).size !== value.length) fail(field, 'has duplicate tags');
  return [...value].sort();
}

function validateGroup(value, keys, field) {
  if (!isPlainObject(value)) fail(field, 'must be an object');
  const given = Object.keys(value);
  if (given.length !== keys.length || !keys.every((k) => Object.hasOwn(value, k))) fail(field, 'must include exactly the vocabulary keys');
  const out = {};
  for (const key of keys) {
    if (typeof value[key] !== 'boolean') fail(field, `${key} must be true or false`);
    out[key] = value[key];
  }
  return out;
}

export function validateChanges(changes, vocabulary) {
  if (!isPlainObject(changes)) throw new HttpError(400, 'changes must be an object');
  const out = {};
  for (const [field, value] of Object.entries(changes)) {
    if (Object.hasOwn(SIMPLE, field)) out[field] = SIMPLE[field](value, field);
    else if (field === 'provider') out.provider = validateProvider(value);
    else if (field === 'download') {
      onlyKeys(value, 'download', ['url']);
      out.download = { url: httpsUrl(value.url, 'download.url', { required: true }) };
    } else if (field === 'description_tags') out.description_tags = validateTopicTags(value, vocabulary.description_tags);
    else if (Object.hasOwn(vocabulary.statistical_tags, field)) out[field] = validateGroup(value, vocabulary.statistical_tags[field], field);
    else fail(field, 'is not editable');
  }
  if (Object.keys(out).length === 0) throw new HttpError(400, 'No changes submitted');
  return out;
}

export function pickEditable(data, vocabulary) {
  const d = isPlainObject(data) ? data : {};
  const picked = {};
  for (const field of TEXT_FIELDS) picked[field] = typeof d[field] === 'string' ? d[field] : d[field] == null ? '' : String(d[field]);
  picked.sensitive = d.sensitive === true;
  picked.requires_account = d.requires_account === true;
  picked.student_suitability = SUITABILITY.includes(d.student_suitability) ? d.student_suitability : 'unreviewed';
  const provider = isPlainObject(d.provider) ? d.provider : {};
  picked.provider = { name: provider.name ?? '', agency: provider.agency ?? '', url: provider.url ?? '' };
  picked.download = { url: isPlainObject(d.download) ? d.download.url ?? '' : '' };
  picked.description_tags = Array.isArray(d.description_tags) ? d.description_tags : [];
  for (const [group, keys] of Object.entries(vocabulary.statistical_tags)) {
    const existing = isPlainObject(d[group]) ? d[group] : {};
    picked[group] = Object.fromEntries(keys.map((k) => [k, existing[k] === true]));
  }
  return picked;
}

// Key-order-insensitive comparison, so reordered tag groups are not a change.
const canonical = (v) =>
  Array.isArray(v)
    ? `[${v.map(canonical).join(',')}]`
    : isPlainObject(v)
      ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
      : JSON.stringify(v ?? null);

export function toTopLevelUpdates(current, normalized, vocabulary) {
  const updates = {};
  for (const [field, value] of Object.entries(normalized)) {
    const merged =
      field === 'provider' || field === 'download'
        ? { ...(isPlainObject(current[field]) ? current[field] : {}), ...value }
        : value;
    if (canonical(merged) !== canonical(current[field])) updates[field] = merged;
  }
  const tagFields = Object.keys(updates).filter((f) => f === 'description_tags' || Object.hasOwn(vocabulary.statistical_tags, f));
  if (tagFields.length) {
    const existing = Array.isArray(current.manual_tags) ? current.manual_tags : [];
    const merged = [...new Set([...existing, ...tagFields])].sort();
    if (canonical(merged) !== canonical(existing)) updates.manual_tags = merged;
  }
  return updates;
}
