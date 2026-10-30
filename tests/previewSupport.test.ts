import { test } from 'node:test';
import assert from 'node:assert/strict';

import { previewUnavailableReason } from '../src/lib/data/previewSupport.ts';

test('CSV and zip downloads can be previewed', () => {
  assert.equal(previewUnavailableReason({ download: { url: 'https://x.gov/data.csv' } }), null);
  assert.equal(previewUnavailableReason({ download: { url: 'https://x.gov/data.zip?v=2' } }), null);
});

test('sources without a download URL are info only', () => {
  assert.match(previewUnavailableReason({})!, /provider's website/);
  assert.match(previewUnavailableReason({ download: { url: '  ' } })!, /provider's website/);
});

test('Excel downloads can be previewed', () => {
  assert.equal(previewUnavailableReason({ download: { url: 'https://x.gov/f.XLSX' } }), null);
  assert.equal(previewUnavailableReason({ download: { url: 'https://x.gov/f.xls#a' } }), null);
});
