/**
 * Netlify Function: librarian API (/api/librarian/*).
 *
 * Lets librarians register community libraries and edit the ones they maintain.
 * Records live in Netlify Database (tables in netlify/database/migrations); logins
 * come from Netlify Identity (@netlify/identity reads the nf_jwt cookie set by the
 * /librarian/ pages). Routes and rules: netlify/lib/librarianApi.mjs.
 *
 * Environment variables (Netlify > Site configuration > Environment variables,
 * scoped to Functions):
 *   COMMUNITY_BUILD_HOOK_URL  Build hook that rebuilds the site after an approval or an
 *                             edit to an approved library. Optional: without it the
 *                             write succeeds and the rebuild is skipped with a warning.
 * NETLIFY_DB_URL is provided by Netlify when the site has a database.
 */

import { getDatabase } from '@netlify/database';
import { getUser } from '@netlify/identity';
import geoVocabulary from '../../src/data/geo-vocabulary.json' with { type: 'json' };
import { createVocabulary } from '../../src/lib/community/geoVocabulary.mjs';
import { normalizeEmail } from '../../src/lib/community/librarianRules.mjs';
import { createBuildHook } from '../lib/buildHook.mjs';
import { createCommunityDb } from '../lib/communityDb.mjs';
import { createLibrarianHandler } from '../lib/librarianApi.mjs';

const vocabulary = createVocabulary(geoVocabulary);

/** The logged-in Identity user, or null. Unconfirmed accounts cannot log in at all. */
async function verifyUser() {
  const user = await getUser();
  const email = normalizeEmail(user?.email);
  return email ? { email, roles: user.roles ?? [] } : null;
}

let db = null;
function openDb() {
  db ??= createCommunityDb(getDatabase().pool);
  return db;
}

export default async (request) =>
  createLibrarianHandler({
    verifyUser,
    db: process.env.NETLIFY_DB_URL ? openDb : null,
    rebuild: createBuildHook({ url: process.env.COMMUNITY_BUILD_HOOK_URL }),
    vocabulary,
  })(request);

export const config = {
  path: ['/api/librarian/libraries', '/api/librarian/libraries/*'],
};
