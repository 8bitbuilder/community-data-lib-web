/**
 * Community libraries and their editors in Netlify Database, for the librarian
 * functions (writes, and the reads those writes need). The build reads published
 * libraries separately (src/lib/community/communityStore.mjs).
 *
 * Takes a pg-style pool (`query(text, params)` and `connect()` for transactions),
 * which is what @netlify/database's getDatabase().pool is in both its drivers.
 * Tables: netlify/database/migrations.
 */

/** The row or slug changed (or appeared) since it was read; the caller should reload. */
export class ConflictError extends Error {}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const COMMUNITY_COLUMNS = `slug, name, place_name, description, county_fips,
  approved_at IS NOT NULL AS approved, created_by, created_at, updated_at`;

function toCommunity(row) {
  if (!row) return null;
  const community = {
    slug: row.slug,
    name: row.name,
    county_fips: String(row.county_fips),
    approved: Boolean(row.approved),
    created_by: row.created_by ?? null,
  };
  if (row.place_name) community.place_name = row.place_name;
  if (row.description) community.description = row.description;
  return community;
}

function rethrow(err) {
  if (err?.code === UNIQUE_VIOLATION || err?.code === FOREIGN_KEY_VIOLATION) {
    throw new ConflictError(err.detail ?? err.message);
  }
  throw err;
}

/** @param {{ query: Function, connect: Function }} pool */
export function createCommunityDb(pool) {
  const rows = async (text, params = []) => {
    try {
      return (await pool.query(text, params)).rows;
    } catch (err) {
      return rethrow(err);
    }
  };

  async function transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn((text, params = []) => client.query(text, params).then((r) => r.rows));
      await client.query('COMMIT');
      return value;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      return rethrow(err);
    } finally {
      client.release();
    }
  }

  /** Attach each library's editor emails. */
  async function withEditors(communities) {
    if (communities.length === 0) return [];
    const editorRows = await rows(
      'SELECT community_slug, email FROM community_editors WHERE community_slug = ANY($1) ORDER BY added_at, email',
      [communities.map((c) => c.slug)]
    );
    return communities.map((c) => ({
      ...c,
      editors: editorRows.filter((r) => r.community_slug === c.slug).map((r) => r.email),
    }));
  }

  return {
    /** Every library, approved or pending, for duplicate checks. */
    async listAll() {
      return (await rows(`SELECT ${COMMUNITY_COLUMNS} FROM communities ORDER BY name`)).map(toCommunity);
    },

    /** One library with its editors, or null. */
    async get(slug) {
      const [row] = await rows(`SELECT ${COMMUNITY_COLUMNS} FROM communities WHERE slug = $1`, [slug]);
      if (!row) return null;
      const [community] = await withEditors([toCommunity(row)]);
      return community;
    },

    /** Libraries `email` edits, with their editors. */
    async listForEditor(email) {
      const found = await rows(
        `SELECT ${COMMUNITY_COLUMNS} FROM communities
         WHERE slug IN (SELECT community_slug FROM community_editors WHERE email = $1)
         ORDER BY name`,
        [email]
      );
      return withEditors(found.map(toCommunity));
    },

    /** Libraries waiting for approval, with their editors (for admins). */
    async listPending() {
      const found = await rows(`SELECT ${COMMUNITY_COLUMNS} FROM communities WHERE approved_at IS NULL ORDER BY created_at`);
      return withEditors(found.map(toCommunity));
    },

    /** A new, pending library with its registrant as first editor, in one transaction. */
    async create(community, email) {
      return transaction(async (query) => {
        await query(
          `INSERT INTO communities (slug, name, place_name, description, county_fips, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [community.slug, community.name, community.place_name ?? null, community.description ?? null, community.county_fips, email]
        );
        await query('INSERT INTO community_editors (community_slug, email, added_by) VALUES ($1, $2, $2)', [community.slug, email]);
      });
    },

    async update(slug, community) {
      const [row] = await rows(
        `UPDATE communities SET name = $2, place_name = $3, description = $4, county_fips = $5, updated_at = now()
         WHERE slug = $1 RETURNING ${COMMUNITY_COLUMNS}`,
        [slug, community.name, community.place_name ?? null, community.description ?? null, community.county_fips]
      );
      return toCommunity(row);
    },

    async addEditor(slug, email, addedBy) {
      await rows('INSERT INTO community_editors (community_slug, email, added_by) VALUES ($1, $2, $3)', [slug, email, addedBy]);
    },

    /** Remove an editor unless they are the last one (checked again here against races). */
    async removeEditor(slug, email) {
      const removed = await rows(
        `DELETE FROM community_editors
         WHERE community_slug = $1 AND email = $2
           AND (SELECT count(*) FROM community_editors WHERE community_slug = $1) > 1
         RETURNING email`,
        [slug, email]
      );
      if (removed.length === 0) throw new ConflictError(`Could not remove ${email} from ${slug}`);
    },

    async approve(slug, approvedBy) {
      const [row] = await rows(
        `UPDATE communities SET approved_at = now(), approved_by = $2, updated_at = now()
         WHERE slug = $1 AND approved_at IS NULL RETURNING ${COMMUNITY_COLUMNS}`,
        [slug, approvedBy]
      );
      if (!row) throw new ConflictError(`${slug} is not waiting for approval`);
      return toCommunity(row);
    },

    /** Delete a library that was never approved (rejecting it); its editors go with it. */
    async reject(slug) {
      const removed = await rows('DELETE FROM communities WHERE slug = $1 AND approved_at IS NULL RETURNING slug', [slug]);
      if (removed.length === 0) throw new ConflictError(`${slug} is not waiting for approval`);
    },
  };
}
