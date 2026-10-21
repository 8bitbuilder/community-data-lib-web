/**
 * In-memory stand-in for netlify/lib/communityDb.mjs with the same methods and
 * the same database rules (unique slug and county, last-editor guard), for
 * testing the librarian API without Postgres.
 */

import { ConflictError } from '../../netlify/lib/communityDb.mjs';

export function createMemoryCommunityDb(seed = []) {
  /** slug -> { community, editors: string[] } */
  const rows = new Map(seed.map(({ editors = [], ...community }) => [community.slug, { community: { ...community }, editors: [...editors] }]));
  const out = ({ community, editors }) => ({ ...community, editors: [...editors] });

  return {
    rows,
    async listAll() {
      return [...rows.values()].map(({ community }) => ({ ...community }));
    },
    async get(slug) {
      const row = rows.get(slug);
      return row ? out(row) : null;
    },
    async listForEditor(email) {
      return [...rows.values()].filter((row) => row.editors.includes(email)).map(out);
    },
    async listPending() {
      return [...rows.values()].filter((row) => !row.community.approved).map(out);
    },
    async create(community, email) {
      if (rows.has(community.slug) || [...rows.values()].some((r) => r.community.county_fips === community.county_fips)) {
        throw new ConflictError('duplicate');
      }
      rows.set(community.slug, { community: { ...community, approved: false, created_by: email }, editors: [email] });
    },
    async update(slug, community) {
      const row = rows.get(slug);
      row.community = { ...community, slug, approved: row.community.approved, created_by: row.community.created_by };
      return { ...row.community };
    },
    async addEditor(slug, email) {
      const row = rows.get(slug);
      if (!row || row.editors.includes(email)) throw new ConflictError('duplicate editor');
      row.editors.push(email);
    },
    async removeEditor(slug, email) {
      const row = rows.get(slug);
      if (!row || row.editors.length <= 1 || !row.editors.includes(email)) throw new ConflictError('cannot remove');
      row.editors = row.editors.filter((e) => e !== email);
    },
    async approve(slug) {
      const row = rows.get(slug);
      if (!row || row.community.approved) throw new ConflictError('not pending');
      row.community.approved = true;
      return { ...row.community };
    },
    async reject(slug) {
      const row = rows.get(slug);
      if (!row || row.community.approved) throw new ConflictError('not pending');
      rows.delete(slug);
    },
  };
}
