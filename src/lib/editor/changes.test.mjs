import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFields } from './changes.mjs';

const original = {
  title: 'Milk',
  notes: '',
  sensitive: false,
  provider: { name: 'USDA', agency: '', url: 'https://usda.gov' },
  download: { url: 'https://usda.gov/a.csv' },
  description_tags: ['Agriculture'],
  anova_tags: { a: false, b: true },
};

test('returns only changed fields', () => {
  const edited = structuredClone(original);
  edited.title = 'Milk 2';
  edited.provider.agency = 'ERS';
  edited.anova_tags.a = true;
  assert.deepEqual(diffFields(original, edited), {
    title: 'Milk 2',
    provider: { agency: 'ERS' },
    anova_tags: { a: true, b: true },
  });
});

test('reordered tag lists are not a change; no edits is empty', () => {
  const o = { ...structuredClone(original), description_tags: ['Agriculture', 'Dairy'] };
  const edited = structuredClone(o);
  edited.description_tags = ['Dairy', 'Agriculture'];
  assert.deepEqual(diffFields(o, edited), {});
});

test('statistical group key order is not a change', () => {
  const edited = structuredClone(original);
  edited.anova_tags = { b: true, a: false };
  assert.deepEqual(diffFields(original, edited), {});
});

test('null original text equals empty edited text', () => {
  const o = { ...structuredClone(original), notes: null };
  const edited = structuredClone(o);
  edited.notes = '';
  assert.deepEqual(diffFields(o, edited), {});
});

test('download changes send only the url', () => {
  const edited = structuredClone(original);
  edited.download.url = 'https://usda.gov/b.csv';
  assert.deepEqual(diffFields(original, edited), { download: { url: 'https://usda.gov/b.csv' } });
});

test('sheet and header_row send only when changed', () => {
  const edited = structuredClone(original);
  edited.download = { url: original.download.url, sheet: '', header_row: '' };
  assert.deepEqual(diffFields(original, edited), {});
  edited.download.sheet = 'Data';
  assert.deepEqual(diffFields(original, edited), { download: { sheet: 'Data' } });
  edited.download.header_row = 4;
  edited.download.url = 'https://usda.gov/b.xlsx';
  assert.deepEqual(diffFields(original, edited), { download: { url: 'https://usda.gov/b.xlsx', sheet: 'Data', header_row: 4 } });
  const had = { ...original, download: { url: 'u', sheet: 'Data', header_row: 4 } };
  assert.deepEqual(diffFields(had, { ...had, download: { url: 'u', sheet: '', header_row: '4' } }), { download: { sheet: null } });
});

test('null sheet/header_row (as sent by readForm) is treated as blank', () => {
  const edited = { ...original, download: { url: original.download.url, sheet: null, header_row: null } };
  assert.deepEqual(diffFields(original, edited), {});
  const had = { ...original, download: { url: 'u', sheet: 'Data', header_row: 4 } };
  assert.deepEqual(diffFields(had, { ...had, download: { url: 'u', sheet: null, header_row: null } }), { download: { sheet: null, header_row: null } });
});
