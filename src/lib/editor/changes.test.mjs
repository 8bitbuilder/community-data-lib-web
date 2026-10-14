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
  const edited = structuredClone(original);
  edited.description_tags = ['Agriculture'];
  assert.deepEqual(diffFields(original, edited), {});
});

test('download changes send only the url', () => {
  const edited = structuredClone(original);
  edited.download.url = 'https://usda.gov/b.csv';
  assert.deepEqual(diffFields(original, edited), { download: { url: 'https://usda.gov/b.csv' } });
});
