/**
 * Librarian portal API (served by netlify/functions/librarian-api.mjs).
 *
 * Every route needs a Netlify Identity login. Permission and validation rules live
 * in src/lib/community/librarianRules.mjs; this module only wires them to HTTP and
 * to the community store (GitHub in production, in-memory in tests).
 *
 * Routes:
 *   GET  /api/librarian/libraries        libraries the logged-in user maintains
 *   POST /api/librarian/libraries        register a new library (user becomes its librarian)
 *   PUT  /api/librarian/libraries/:slug  edit a library the user maintains
 */

import { checkRegistration, checkUpdate, isLibrarian } from '../../src/lib/community/librarianRules.mjs';
import { ConflictError } from './githubCommunityStore.mjs';

const MAX_BODY_BYTES = 20_000;
const PREFIX = '/api/librarian/libraries';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const error = (status, message, errors = []) => json(status, { error: message, errors });

async function readJson(request) {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return { tooLarge: true };
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' && !Array.isArray(value) ? { value } : {};
  } catch {
    return {};
  }
}

/**
 * @param {object} deps
 * @param {(request: Request) => Promise<{ email: string } | null>} deps.verifyUser
 * @param {ReturnType<typeof import('./githubCommunityStore.mjs').createGitHubCommunityStore> | null} deps.store
 *   null when the function isn't configured (no GitHub token).
 */
export function createLibrarianHandler({ verifyUser, store }) {
  return async function handle(request) {
    const { pathname } = new URL(request.url);
    const rest = pathname.replace(/\/+$/, '');
    if (rest !== PREFIX && !rest.startsWith(`${PREFIX}/`)) return error(404, 'Not found');
    const slug = rest === PREFIX ? null : decodeURIComponent(rest.slice(PREFIX.length + 1));

    if (!store) return error(503, 'The librarian portal is not configured on this site yet.');

    const user = await verifyUser(request);
    if (!user) return error(401, 'Log in with a confirmed email to continue.');

    try {
      if (request.method === 'GET' && !slug) {
        const all = await store.list();
        const libraries = all
          .filter((entry) => entry && isLibrarian(entry.community, user.email))
          .map((entry) => entry.community);
        return json(200, { email: user.email, libraries });
      }

      if (request.method === 'POST' && !slug) {
        const body = await readJson(request);
        if (body.tooLarge) return error(413, 'Request is too large.');
        if (!body.value) return error(400, 'Send the library details as JSON.');

        const existing = (await store.list()).filter(Boolean).map((entry) => entry.community);
        const result = checkRegistration({ input: body.value, email: user.email, existing });
        if (!result.ok) return error(result.status, 'The library could not be registered.', result.errors);

        await store.create(
          result.community,
          `Register community library ${result.community.slug}\n\nRegistered through the librarian portal by ${user.email}.`,
        );
        return json(201, { community: result.community });
      }

      if (request.method === 'PUT' && slug) {
        const body = await readJson(request);
        if (body.tooLarge) return error(413, 'Request is too large.');
        if (!body.value) return error(400, 'Send the library details as JSON.');

        const current = await store.get(slug).catch(() => null);
        if (!current) return error(404, `No community library "${slug}".`);

        const existing = (await store.list()).filter(Boolean).map((entry) => entry.community);
        const result = checkUpdate({ current: current.community, input: body.value, email: user.email, existing });
        if (!result.ok) return error(result.status, 'The library could not be saved.', result.errors);

        await store.update(
          result.community,
          current.body,
          current.sha,
          `Update community library ${slug}\n\nEdited through the librarian portal by ${user.email}.`,
        );
        return json(200, { community: result.community });
      }

      return error(405, 'Method not allowed');
    } catch (err) {
      if (err instanceof ConflictError) {
        return error(409, 'This library changed or was just registered by someone else. Reload and try again.');
      }
      console.error('librarian-api error:', err);
      return error(502, 'Saving failed. Please try again in a minute.');
    }
  };
}
