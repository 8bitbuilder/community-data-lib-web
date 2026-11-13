import { test } from 'node:test';
import assert from 'node:assert/strict';

import { seedStatements, toPlainSql } from '../scripts/seed-communities.mjs';

const knox = { slug: 'knox-county', name: "Knox County's Library", place_name: 'Knoxville', county_fips: '47093' };

test('each library is upserted, then each editor added to it', () => {
  const statements = seedStatements([knox], ['a@x.org', 'b@y.org']);
  assert.equal(statements.length, 3);
  assert.match(statements[0][0], /ON CONFLICT \(slug\) DO UPDATE/);
  assert.match(statements[0][0], /COALESCE\(communities\.approved_at/);
  assert.deepEqual(statements[0][1], ['knox-county', "Knox County's Library", 'Knoxville', null, '47093']);
  assert.deepEqual(statements[2][1], ['knox-county', 'b@y.org']);
  assert.match(statements[1][0], /ON CONFLICT \(community_slug, email\) DO NOTHING/);
});

test('dry-run SQL inlines quoted values and NULLs', () => {
  const sql = toPlainSql(seedStatements([knox], [])[0]);
  assert.match(sql, /VALUES \('knox-county', 'Knox County''s Library', 'Knoxville', NULL, '47093', 'seed'/);
  assert.ok(sql.endsWith(';'));
});
