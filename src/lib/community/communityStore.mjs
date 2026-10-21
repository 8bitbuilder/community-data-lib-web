/**
 * Where the build reads community libraries from.
 *
 * A CommunityStore has one method, listPublished(), returning the libraries the
 * site should build pages for, as { slug, name, place_name?, description?, county_fips }.
 *
 *   createDatabaseStore(db)  Netlify Database (Postgres): approved rows of `communities`.
 *   createFileStore(dir)     src/content/communities/*.md, the fallback for builds
 *                            without a database (local builds, CI, GitHub Pages).
 *
 * loadCommunities() picks one, warns loudly when it falls back to the files, and
 * adds each library's state code and county name from the Census vocabulary
 * (they are not stored). An unknown county FIPS code fails the build.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describeCounty } from './geoVocabulary.mjs';
import { parseCommunityMarkdown } from './communityFile.mjs';

const PUBLISHED_COLUMNS = ['slug', 'name', 'place_name', 'description', 'county_fips'];

/** Postgres "undefined_table": the migrations have not run on this database yet. */
export function isMissingTable(err) {
  return err?.code === '42P01';
}

/** Drop null/empty optional fields so records look the same from either store. */
function clean(record) {
  const out = {};
  for (const key of PUBLISHED_COLUMNS) {
    const value = record[key];
    if (value === null || value === undefined || value === '') continue;
    out[key] = String(value).trim();
  }
  return out;
}

/**
 * @param {{ query: (text: string, params?: unknown[]) => Promise<object[]> }} db
 */
export function createDatabaseStore(db) {
  return {
    source: 'Netlify Database',
    async listPublished() {
      const rows = await db.query(
        `SELECT ${PUBLISHED_COLUMNS.join(', ')} FROM communities WHERE approved_at IS NOT NULL ORDER BY slug`
      );
      return rows.map(clean);
    },
  };
}

/** @param {string} dir Folder of community Markdown files. */
export function createFileStore(dir) {
  return {
    source: `files in ${dir}`,
    async listPublished() {
      const names = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith('.md')).sort();
      const records = [];
      for (const name of names) {
        const { data } = parseCommunityMarkdown(await readFile(path.join(dir, name), 'utf8'));
        records.push(clean(data));
      }
      return records;
    },
  };
}

/** Connect with @netlify/database (imported only when a database is configured). */
async function connectNetlifyDatabase() {
  const { getDatabase } = await import('@netlify/database');
  const db = getDatabase();
  return {
    query: async (text, params) => (await db.pool.query(text, params)).rows,
    // The build's pg.Pool keeps the process alive until it is closed.
    close: () => db.pool.end(),
  };
}

function loud(log, lines) {
  const bar = '='.repeat(78);
  log.warn([bar, ...lines.map((line) => `WARNING: ${line}`), bar].join('\n'));
}

/**
 * Libraries to build, with state_code / county / state_name derived from the vocabulary.
 *
 * @param {object} options
 * @param {ReturnType<import('./geoVocabulary.mjs').createVocabulary>} options.vocabulary
 * @param {string} options.dir Fallback folder of community Markdown files.
 * @param {Record<string, string | undefined>} [options.env] NETLIFY_DB_URL, CONTEXT
 * @param {{ warn: Function, info: Function }} [options.log]
 * @param {() => Promise<{ query: Function, close?: Function }>} [options.connect]
 */
export async function loadCommunities({ vocabulary, dir, env = process.env, log = console, connect = connectNetlifyDatabase }) {
  let records = null;
  let source = '';
  if (env.NETLIFY_DB_URL) {
    let db = null;
    try {
      db = await connect();
      const store = createDatabaseStore(db);
      records = await store.listPublished();
      source = store.source;
    } catch (err) {
      if (isMissingTable(err)) {
        loud(log, [
          'Netlify Database has no communities table yet (migrations run when a deploy is',
          `published, after this build). Building community pages from ${dir} instead.`,
        ]);
      } else if (env.CONTEXT === 'production') {
        // Never publish a production site that silently lost its libraries.
        throw new Error(`Could not read community libraries from Netlify Database: ${err.message ?? err}`);
      } else {
        loud(log, [`Could not read community libraries from Netlify Database (${err.message ?? err}).`, `Building community pages from ${dir} instead.`]);
      }
    } finally {
      await db?.close?.();
    }
  } else {
    loud(log, [
      'NETLIFY_DB_URL is not set, so community libraries come from the Markdown files in',
      `${dir}, not from Netlify Database. Fine for local and CI builds; on Netlify,`,
      'check that the site has a database (Data & Storage > Database).',
    ]);
  }
  if (!records) {
    const store = createFileStore(dir);
    records = await store.listPublished();
    source = store.source;
  }

  const unknown = records.filter((r) => !describeCounty(vocabulary, r.county_fips));
  if (unknown.length > 0) {
    throw new Error(
      `Community libraries with a county FIPS code not in the ${vocabulary.vintage} Census vocabulary ` +
        `(src/data/geo-vocabulary.json): ${unknown.map((r) => `${r.slug} (${r.county_fips ?? 'none'})`).join(', ')}`
    );
  }
  log.info?.(`Community libraries: ${records.length} from ${source}.`);
  return records.map((record) => {
    const { county, state_code, state_name } = describeCounty(vocabulary, record.county_fips);
    return { ...record, county, state_code, state_name };
  });
}
