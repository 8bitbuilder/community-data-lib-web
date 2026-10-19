import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getPedagogicalTags } from '../src/lib/api/tags.ts';
// @ts-expect-error plain .mjs module without types
import { extractPedagogicalTags } from '../scripts/sync-catalog-from-backend.mjs';

const source = {
  manual_tags: ['description_tags', 'anova_tags'],
  anova_tags: { 'good-for-one-way-anova': true, 'good-for-two-way-anova': false },
};

test('getPedagogicalTags ignores manual_tags', () => {
  assert.deepEqual(getPedagogicalTags(source as never), ['good for one way anova']);
});

test('sync extractPedagogicalTags ignores manual_tags', () => {
  assert.deepEqual(extractPedagogicalTags(source), ['good for one way anova']);
});
