import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickEditable, validateChanges, toTopLevelUpdates } from './editableFields.mjs';

const vocab = {
  description_tags: ['Agriculture', 'Population Data', 'Transportation'],
  statistical_tags: { anova_tags: ['good-for-one-way-anova', 'good-for-two-way-anova'] },
};

const current = {
  id: 'ds',
  title: 'Old',
  notes: null,
  provider: { name: 'USDA', agency: 'ERS', url: 'https://usda.gov' },
  download: { url: 'https://usda.gov/a.csv', format: 'csv' },
  description_tags: ['Agriculture'],
  student_suitability: 'unreviewed',
};

const fieldOf = (fn) => {
  try { fn(); } catch (e) { return [e.status, e.field]; }
  return 'no error';
};

test('pickEditable fills defaults, including tag groups missing from the file', () => {
  const picked = pickEditable(current, vocab);
  assert.equal(picked.notes, '');
  assert.equal(picked.sensitive, false);
  assert.deepEqual(picked.download, { url: 'https://usda.gov/a.csv' });
  assert.deepEqual(picked.anova_tags, { 'good-for-one-way-anova': false, 'good-for-two-way-anova': false });
});

test('validates and trims text fields', () => {
  assert.deepEqual(validateChanges({ title: '  New  ', notes: '' }, vocab), { title: 'New', notes: null });
  assert.deepEqual(fieldOf(() => validateChanges({ title: '   ' }, vocab)), [400, 'title']);
  assert.deepEqual(fieldOf(() => validateChanges({ who: 'x'.repeat(501) }, vocab)), [400, 'who']);
  assert.deepEqual(fieldOf(() => validateChanges({ title: 5 }, vocab)), [400, 'title']);
});

test('rejects unknown and read-only fields', () => {
  for (const field of ['id', 'version', 'variable_names', 'manual_tags', 'surprise']) {
    assert.deepEqual(fieldOf(() => validateChanges({ [field]: 'x' }, vocab)), [400, field]);
  }
  assert.deepEqual(fieldOf(() => validateChanges({}, vocab)), [400, undefined]);
  assert.deepEqual(fieldOf(() => validateChanges(['title'], vocab)), [400, undefined]);
});

test('validates URLs, booleans, and suitability', () => {
  assert.deepEqual(fieldOf(() => validateChanges({ download: { url: 'http://x.org' } }, vocab)), [400, 'download.url']);
  assert.deepEqual(fieldOf(() => validateChanges({ download: { url: 'https://x.org', format: 'zip' } }, vocab)), [400, 'download.format']);
  assert.deepEqual(fieldOf(() => validateChanges({ provider: { url: 'javascript:alert(1)' } }, vocab)), [400, 'provider.url']);
  assert.deepEqual(validateChanges({ provider: { url: '' } }, vocab), { provider: { url: null } });
  assert.deepEqual(fieldOf(() => validateChanges({ sensitive: 'true' }, vocab)), [400, 'sensitive']);
  assert.deepEqual(fieldOf(() => validateChanges({ student_suitability: 'maybe' }, vocab)), [400, 'student_suitability']);
});

test('validates tags against the vocabulary', () => {
  assert.deepEqual(validateChanges({ description_tags: ['Transportation', 'Agriculture'] }, vocab), {
    description_tags: ['Agriculture', 'Transportation'],
  });
  assert.deepEqual(fieldOf(() => validateChanges({ description_tags: ['Made Up'] }, vocab)), [400, 'description_tags']);
  assert.deepEqual(fieldOf(() => validateChanges({ description_tags: ['Agriculture', 'Agriculture'] }, vocab)), [400, 'description_tags']);
  assert.deepEqual(fieldOf(() => validateChanges({ anova_tags: { 'good-for-one-way-anova': true } }, vocab)), [400, 'anova_tags']);
  assert.deepEqual(fieldOf(() => validateChanges({ anova_tags: { 'good-for-one-way-anova': 'yes', 'good-for-two-way-anova': false } }, vocab)), [400, 'anova_tags']);
});

test('toTopLevelUpdates merges nested objects and drops no-ops', () => {
  const normalized = validateChanges({ title: 'Old', provider: { agency: 'NASS' }, download: { url: 'https://usda.gov/b.csv' } }, vocab);
  assert.deepEqual(toTopLevelUpdates(current, normalized, vocab), {
    provider: { name: 'USDA', agency: 'NASS', url: 'https://usda.gov' },
    download: { url: 'https://usda.gov/b.csv', format: 'csv' },
  });
});

test('tag changes add the field to manual_tags; unchanged tags do not', () => {
  const group = { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false };
  const updates = toTopLevelUpdates(current, validateChanges({ anova_tags: group, description_tags: ['Agriculture'] }, vocab), vocab);
  assert.deepEqual(updates, { anova_tags: group, manual_tags: ['anova_tags'] });
});

test('group key order does not count as a change', () => {
  const withGroup = { ...current, anova_tags: { 'good-for-two-way-anova': false, 'good-for-one-way-anova': true } };
  const normalized = validateChanges({ anova_tags: { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false } }, vocab);
  assert.deepEqual(toTopLevelUpdates(withGroup, normalized, vocab), {});
});

test('rejects inherited property names (constructor, toString, __proto__)', () => {
  assert.deepEqual(fieldOf(() => validateChanges(JSON.parse('{"constructor":"x"}'), vocab)), [400, 'constructor']);
  assert.deepEqual(fieldOf(() => validateChanges(JSON.parse('{"toString":"x"}'), vocab)), [400, 'toString']);
  assert.deepEqual(fieldOf(() => validateChanges(JSON.parse('{"__proto__":{}}'), vocab)), [400, '__proto__']);
});

test('toTopLevelUpdates does not add manual_tags for inherited properties', () => {
  const result = toTopLevelUpdates(current, { toString: 'x' }, vocab);
  assert(!('manual_tags' in result), 'manual_tags should not be added for non-tag fields');
});

test('pickEditable handles non-object data gracefully', () => {
  assert.deepEqual(pickEditable(null, vocab), pickEditable({}, vocab));
  assert.deepEqual(pickEditable('x', vocab), pickEditable({}, vocab));
});

test('tag changes merge into existing manual_tags', () => {
  const withExisting = { ...current, manual_tags: ['description_tags'] };
  const normalized = validateChanges({ anova_tags: { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false } }, vocab);
  const updates = toTopLevelUpdates(withExisting, normalized, vocab);
  assert.deepEqual(updates, {
    anova_tags: { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false },
    manual_tags: ['anova_tags', 'description_tags'],
  });
});
