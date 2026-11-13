/**
 * One-time seed: copy the community libraries in src/content/communities/*.md
 * into Netlify Database as approved libraries, optionally with their editors.
 *
 * Safe to re-run: libraries are upserted by slug (an existing approval is kept)
 * and editors are only added, never removed.
 *
 * Usage:
 *   NETLIFY_DB_URL=postgres://... npm run db:seed -- --editor librarian@example.org
 *   npm run db:seed -- --connection postgres://... --editor a@x.org --editor b@y.org
 *   npm run db:seed -- --dry-run --editor a@x.org    # print the SQL instead of running it
 *   npm run db:seed -- --only knox-county ...         # just these slugs
 *
 * Every --editor is added to every seeded library. The connection string for the
 * production database is on the site's Data & Storage > Database page.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createVocabulary, describeCounty } from '../src/lib/community/geoVocabulary.mjs';
import { createFileStore } from '../src/lib/community/communityStore.mjs';
import { isValidEmail, normalizeEmail } from '../src/lib/community/librarianRules.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const UPSERT_COMMUNITY = `INSERT INTO communities (slug, name, place_name, description, county_fips, created_by, approved_at, approved_by)
VALUES ($1, $2, $3, $4, $5, 'seed', now(), 'seed')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  place_name = EXCLUDED.place_name,
  description = EXCLUDED.description,
  county_fips = EXCLUDED.county_fips,
  approved_at = COALESCE(communities.approved_at, EXCLUDED.approved_at),
  approved_by = COALESCE(communities.approved_by, EXCLUDED.approved_by),
  updated_at = now()`;

const ADD_EDITOR = `INSERT INTO community_editors (community_slug, email, added_by)
VALUES ($1, $2, 'seed')
ON CONFLICT (community_slug, email) DO NOTHING`;

/** The statements to run, as [sql, params] pairs. Pure, for --dry-run and tests. */
export function seedStatements(communities, editors) {
  const statements = [];
  for (const c of communities) {
    statements.push([UPSERT_COMMUNITY, [c.slug, c.name, c.place_name ?? null, c.description ?? null, c.county_fips]]);
    for (const email of editors) statements.push([ADD_EDITOR, [c.slug, email]]);
  }
  return statements;
}

const literal = (value) => (value === null ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);

/** Inline the parameters so the SQL can be pasted into a psql session. */
export function toPlainSql([sql, params]) {
  return `${sql.replace(/\$(\d+)/g, (_, n) => literal(params[Number(n) - 1]))};`;
}

async function main() {
  const { values } = parseArgs({
    options: {
      editor: { type: 'string', multiple: true, default: [] },
      only: { type: 'string', multiple: true, default: [] },
      connection: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const editors = [...new Set(values.editor.map(normalizeEmail))];
  const badEmails = editors.filter((email) => !isValidEmail(email));
  if (badEmails.length > 0) throw new Error(`Not valid emails: ${badEmails.join(', ')}`);

  const vocabulary = createVocabulary(JSON.parse(await readFile(path.join(webRoot, 'src/data/geo-vocabulary.json'), 'utf8')));
  let communities = await createFileStore(path.join(webRoot, 'src/content/communities')).listPublished();
  if (values.only.length > 0) communities = communities.filter((c) => values.only.includes(c.slug));
  if (communities.length === 0) throw new Error('No community files to seed.');
  for (const c of communities) {
    if (!describeCounty(vocabulary, c.county_fips)) throw new Error(`${c.slug}: county FIPS ${c.county_fips} is not in the vocabulary`);
  }

  const statements = seedStatements(communities, editors);
  if (values['dry-run']) {
    console.log('BEGIN;');
    for (const statement of statements) console.log(toPlainSql(statement));
    console.log('COMMIT;');
    return;
  }

  const connectionString = values.connection ?? process.env.NETLIFY_DB_URL;
  if (!connectionString) throw new Error('Pass --connection or set NETLIFY_DB_URL (or use --dry-run).');
  const { getDatabase } = await import('@netlify/database');
  const { pool } = getDatabase({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [sql, params] of statements) await client.query(sql, params);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
  console.log(
    `Seeded ${communities.map((c) => c.slug).join(', ')}` +
      (editors.length > 0 ? ` with editor(s) ${editors.join(', ')}.` : ' (no editors; add some with --editor).')
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
