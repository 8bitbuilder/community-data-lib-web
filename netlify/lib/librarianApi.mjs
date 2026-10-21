/**
 * Librarian API (served by netlify/functions/librarian-api.mjs).
 *
 * Every route needs a Netlify Identity login. Permission and validation rules live
 * in src/lib/community/librarianRules.mjs; this module wires them to HTTP and to
 * Netlify Database (netlify/lib/communityDb.mjs). Functions only handle these
 * librarian reads and writes; they never read or filter datasets.
 *
 * Routes (all under /api/librarian/libraries):
 *   GET    /                         libraries the user edits (+ pending ones, for admins)
 *   POST   /                         register a library (pending; the user becomes its first editor)
 *   GET    /:slug                    one library with its editors (editors and admins)
 *   PUT    /:slug                    edit a library (editors)
 *   POST   /:slug/editors            add an editor { email } (editors)
 *   DELETE /:slug/editors/:email     remove an editor (editors; never the last one)
 *   POST   /:slug/approve            approve a pending library (admins)
 *   DELETE /:slug                    reject a pending library (admins)
 *
 * Writes check the Origin header (the login is a cookie). Approving a library or
 * editing an approved one rebuilds the site through the build hook.
 */

import { describeCounty } from '../../src/lib/community/geoVocabulary.mjs';
import {
  checkAddEditor,
  checkRegistration,
  checkRemoveEditor,
  checkReview,
  checkUpdate,
  isAdmin,
  isAllowedOrigin,
  isEditor,
  rebuildReason,
} from '../../src/lib/community/librarianRules.mjs';
import { ConflictError } from './communityDb.mjs';

const MAX_BODY_BYTES = 20_000;
const PREFIX = '/api/librarian/libraries';

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const error = (status, message, errors = []) => json(status, { error: message, errors });
const refused = (check) => error(check.status, check.errors[0]?.message ?? 'Not allowed.', check.errors);

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

/** "/api/librarian/libraries/knox-county/editors/a%40b.org" -> ['knox-county', 'editors', 'a@b.org'] */
export function routeParts(pathname) {
  const rest = pathname.replace(/\/+$/, '');
  if (rest !== PREFIX && !rest.startsWith(`${PREFIX}/`)) return null;
  return rest
    .slice(PREFIX.length)
    .split('/')
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

/**
 * @param {object} deps
 * @param {(request: Request) => Promise<{ email: string, roles: string[] } | null>} deps.verifyUser
 * @param {(() => ReturnType<typeof import('./communityDb.mjs').createCommunityDb>) | null} deps.db
 *   null when the site has no database configured.
 * @param {(reason: string) => Promise<string>} deps.rebuild
 * @param {ReturnType<typeof import('../../src/lib/community/geoVocabulary.mjs').createVocabulary>} deps.vocabulary
 */
export function createLibrarianHandler({ verifyUser, db: openDb, rebuild, vocabulary }) {
  /** A library as the pages show it: stored fields plus state and county names. */
  const view = (community) => ({ ...community, ...(describeCounty(vocabulary, community.county_fips) ?? {}) });

  async function maybeRebuild(action, community) {
    const reason = rebuildReason(action, community);
    return reason ? rebuild(reason) : 'not needed';
  }

  return async function handle(request) {
    const parts = routeParts(new URL(request.url).pathname);
    if (!parts) return error(404, 'Not found');
    if (!openDb) return error(503, 'The librarian portal is not configured on this site yet (no database).');

    const user = await verifyUser(request).catch(() => null);
    if (!user) return error(401, 'Log in with a confirmed email to continue.');
    if (request.method !== 'GET' && !isAllowedOrigin(request)) {
      return error(403, 'This request did not come from the librarian pages of this site.');
    }

    const db = openDb();
    const [slug, sub, subject] = parts;
    const method = request.method;

    async function body() {
      const parsed = await readJson(request);
      if (parsed.tooLarge) return { response: error(413, 'Request is too large.') };
      if (!parsed.value) return { response: error(400, 'Send the details as JSON.') };
      return { value: parsed.value };
    }

    try {
      // ── Collection ───────────────────────────────────────────────
      if (!slug) {
        if (method === 'GET') {
          const admin = isAdmin(user);
          return json(200, {
            email: user.email,
            isAdmin: admin,
            libraries: (await db.listForEditor(user.email)).map(view),
            pending: admin ? (await db.listPending()).map(view) : [],
          });
        }
        if (method === 'POST') {
          const input = await body();
          if (input.response) return input.response;
          const check = checkRegistration({ input: input.value, user, existing: await db.listAll(), vocabulary });
          if (!check.ok) return error(check.status, 'The library could not be registered.', check.errors);
          await db.create(check.community, user.email);
          return json(201, { library: view({ ...check.community, approved: false, editors: check.editors }) });
        }
        return error(405, 'Method not allowed');
      }

      const current = await db.get(slug);
      if (!current) return error(404, 'No such library.');
      const editor = isEditor(current.editors, user.email);

      // ── One library ──────────────────────────────────────────────
      if (!sub) {
        if (method === 'GET') {
          if (!editor && !isAdmin(user)) return error(403, 'Only this library’s editors can see its settings.');
          return json(200, { library: view(current), canEdit: editor, isAdmin: isAdmin(user) });
        }
        if (method === 'PUT') {
          const input = await body();
          if (input.response) return input.response;
          const others = (await db.listAll()).filter((c) => c.slug !== slug);
          const check = checkUpdate({ current, editors: current.editors, input: input.value, user, existing: others, vocabulary });
          if (!check.ok) return error(check.status, 'The library could not be saved.', check.errors);
          const updated = await db.update(slug, check.community);
          return json(200, {
            library: view({ ...updated, editors: current.editors }),
            rebuild: await maybeRebuild('update', updated),
          });
        }
        if (method === 'DELETE') {
          const check = checkReview({ user, community: current });
          if (!check.ok) return refused(check);
          await db.reject(slug);
          return json(200, { rejected: slug });
        }
        return error(405, 'Method not allowed');
      }

      if (sub === 'approve' && !subject) {
        if (method !== 'POST') return error(405, 'Method not allowed');
        const check = checkReview({ user, community: current });
        if (!check.ok) return refused(check);
        const approved = await db.approve(slug, user.email);
        return json(200, {
          library: view({ ...approved, editors: current.editors }),
          rebuild: await maybeRebuild('approve', approved),
        });
      }

      if (sub === 'editors') {
        if (method === 'POST' && !subject) {
          const input = await body();
          if (input.response) return input.response;
          const check = checkAddEditor({ editors: current.editors, user, email: input.value.email });
          if (!check.ok) return refused(check);
          await db.addEditor(slug, check.email, user.email);
          return json(201, { editors: [...current.editors, check.email] });
        }
        if (method === 'DELETE' && subject) {
          const check = checkRemoveEditor({ editors: current.editors, user, email: subject });
          if (!check.ok) return refused(check);
          await db.removeEditor(slug, check.email);
          return json(200, { editors: current.editors.filter((e) => e !== check.email) });
        }
        return error(405, 'Method not allowed');
      }
      return error(404, 'Not found');
    } catch (err) {
      if (err instanceof ConflictError) {
        return error(409, 'This library changed or was just registered by someone else. Reload and try again.');
      }
      console.error('librarian-api error:', err);
      return error(502, 'Saving failed. Please try again in a minute.');
    }
  };
}
