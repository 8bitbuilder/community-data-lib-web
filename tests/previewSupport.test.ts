import { test } from 'node:test';
import assert from 'node:assert/strict';

import { previewUnavailableReason } from '../src/lib/data/previewSupport.ts';

const csv = { download: { url: 'https://x.gov/data.csv' } };

test('sources with a Tier 1 preview can be previewed, Excel included', () => {
  assert.equal(previewUnavailableReason(csv, { status: 'ok' }), null);
  assert.equal(previewUnavailableReason({ download: { url: 'https://x.gov/f.XLSX' } }, { status: 'ok' }), null);
});

test('sources without a download URL are info only', () => {
  assert.match(previewUnavailableReason({}, { status: 'none', reason: 'no direct download' })!, /provider's website/);
  assert.match(previewUnavailableReason({ download: { url: '  ' } })!, /provider's website/);
});

test('a download the exporter could not read says which format', () => {
  const reason = previewUnavailableReason(csv, { status: 'none', reason: 'unsupported format: zip contains no CSV (.accdb)' });
  assert.match(reason!, /a zip of \.accdb files/);
});

test('a build without preview files says so instead of failing', () => {
  assert.match(previewUnavailableReason(csv, undefined)!, /isn't available on this copy/);
  assert.match(previewUnavailableReason(csv, { status: 'none', reason: 'export failed' })!, /isn't available yet/);
});
