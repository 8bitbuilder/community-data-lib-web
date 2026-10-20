/**
 * Librarian portal API (served by netlify/functions/librarian-api.mjs).
 *
 * Every route needs a Netlify Identity login. Permission and validation rules live
 * in src/lib/community/librarianRules.mjs; this module wires them to HTTP, to the
 * public community files (GitHub), and to the private librarian records (Blobs).
 *
 * Routes:
 *   GET  /api/librarian/libraries        libraries the logged-in user maintains, with status
 *   POST /api/librarian/libraries        register a library: opens a pull request for approval
 *   PUT  /api/librarian/libraries/:slug  edit an approved library the user maintains
 *
 * Librarian emails never go into commits, pull requests, or community files; only a
 * masked form of the registrant's email appears in the approval pull request.
 */

import {
  checkRegistration,
  checkUpdate,
  isLibrarian,
} from '../../src/lib/community/librarianRules.mjs';
import { serializeCommunityMarkdown } from '../../src/lib/community/communityFile.mjs';
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

/** "jane.doe@utk.edu" -> "j***@utk.edu", enough for a reviewer without publishing it. */
export function maskEmail(email) {
  const [local = '', domain = ''] = String(email).split('@');
  return `${local.slice(0, 1)}***@${domain}`;
}

function approvalRequest(community, email) {
  const rows = [
    ['Library', community.name],
    ['Place', community.place_name],
    ['State', community.state_code],
    ['County', community.county],
    ['County FIPS', community.county_fips],
    ['ZIP codes', community.zip_codes.join(', ')],
    ['Description', community.description],
    ['Registered by', `${maskEmail(email)} (confirmed Netlify Identity login)`],
  ].filter(([, value]) => value);
  return [
    'A new community library was registered through the librarian portal.',
    '',
    '| Field | Value |',
    '| --- | --- |',
    ...rows.map(([field, value]) => `| ${field} | ${String(value).replace(/[|\r\n]+/g, ' ')} |`),
    '',
    '**Merge to approve** (the library goes live on the next deploy). **Close to reject.**',
    'The full registrant email is in the site\'s Netlify Blobs store "librarians".',
  ].join('\n');
}

/**
 * @param {object} deps
 * @param {(request: Request) => Promise<{ email: string } | null>} deps.verifyUser
 * @param {ReturnType<typeof import('./githubCommunityStore.mjs').createGitHubCommunityStore> | null} deps.github
 *   null when the function isn't configured (no GitHub token).
 * @param {ReturnType<typeof import('./librarianStore.mjs').createLibrarianStore> | null} deps.librarians
 * @param {() => string} [deps.now]
 */
export function createLibrarianHandler({ verifyUser, github, librarians, now = () => new Date().toISOString() }) {
  /** Bring a pending record up to date with its pull request (merged = approved, closed = rejected). */
  async function resolveStatus(slug, record) {
    if (record.status !== 'pending' || !record.pull_request) return record;
    const pull = await github.getPullRequest(record.pull_request);
    const status = pull?.merged ? 'approved' : pull?.state === 'closed' ? 'rejected' : 'pending';
    if (status === record.status) return record;
    const updated = { ...record, status };
    await librarians.set(slug, updated);
    return updated;
  }

  /** Live libraries plus ones awaiting approval, for duplicate checks. */
  async function knownLibraries() {
    const live = (await github.list()).map((entry) => entry.community);
    const pending = [];
    for (const record of await librarians.list()) {
      const current = await resolveStatus(record.slug, record);
      if (current.status === 'pending' && !live.some((c) => c.slug === record.slug)) {
        pending.push({ slug: record.slug, name: record.name, county_fips: record.county_fips, pending: true });
      }
    }
    return [...live, ...pending];
  }

  async function listMine(email) {
    const mine = (await librarians.list()).filter((record) => isLibrarian(record.emails, email));
    const libraries = [];
    for (const record of mine) {
      const { slug } = record;
      const current = await resolveStatus(slug, record);
      const file = current.status === 'approved' ? await github.get(slug) : null;
      libraries.push({
        slug,
        name: file?.community.name ?? current.name,
        status: current.status,
        // Approved but not yet on the main branch (deploy in progress) counts as unpublished.
        published: Boolean(file),
        community: file?.community ?? current.community ?? null,
        librarians: current.emails,
        pull_request_url: current.pull_request_url ?? null,
      });
    }
    return libraries.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function register(user, input) {
    const result = checkRegistration({ input, email: user.email, existing: await knownLibraries() });
    if (!result.ok) return error(result.status, 'The library could not be registered.', result.errors);

    const { community } = result;
    const record = {
      emails: result.librarians,
      status: 'pending',
      name: community.name,
      county_fips: community.county_fips,
      community,
      created_at: now(),
    };
    // Claim the slug before opening the pull request; release it if that fails.
    await librarians.set(community.slug, record);
    let pull;
    try {
      pull = await github.proposeNew(community, {
        message: `Register community library ${community.slug}`,
        title: `New community library: ${community.name}`,
        body: approvalRequest(community, user.email),
      });
    } catch (err) {
      await librarians.delete(community.slug);
      throw err;
    }
    await librarians.set(community.slug, { ...record, pull_request: pull.number, pull_request_url: pull.url });
    return json(202, { community, status: 'pending', pull_request_url: pull.url });
  }

  async function update(user, slug, input) {
    const record = await librarians.get(slug).catch(() => null);
    if (!record || !isLibrarian(record.emails, user.email)) {
      return error(403, 'Only this library’s librarians can edit it.');
    }
    const current = await resolveStatus(slug, record);
    if (current.status !== 'approved') {
      return error(409, current.status === 'pending'
        ? 'This library is still awaiting approval. You can edit it once it is approved.'
        : 'This library was not approved. Register it again or contact the team.');
    }
    const file = await github.get(slug);
    if (!file) return error(409, 'This library is approved but not published yet. Try again in a few minutes.');

    const result = checkUpdate({
      current: file.community,
      librarians: current.emails,
      input,
      email: user.email,
      existing: await knownLibraries(),
    });
    if (!result.ok) return error(result.status, 'The library could not be saved.', result.errors);

    const fileChanged =
      serializeCommunityMarkdown(result.community, file.body) !== serializeCommunityMarkdown(file.community, file.body);
    if (fileChanged) {
      await github.update(result.community, file.body, file.sha, `Update community library ${slug}`);
    }
    await librarians.set(slug, { ...current, emails: result.librarians, name: result.community.name, county_fips: result.community.county_fips });
    return json(200, { community: result.community, librarians: result.librarians, published: fileChanged });
  }

  return async function handle(request) {
    const { pathname } = new URL(request.url);
    const rest = pathname.replace(/\/+$/, '');
    if (rest !== PREFIX && !rest.startsWith(`${PREFIX}/`)) return error(404, 'Not found');
    const slug = rest === PREFIX ? null : decodeURIComponent(rest.slice(PREFIX.length + 1));

    if (!github || !librarians) return error(503, 'The librarian portal is not configured on this site yet.');

    const user = await verifyUser(request);
    if (!user) return error(401, 'Log in with a confirmed email to continue.');

    try {
      if (request.method === 'GET' && !slug) {
        return json(200, { email: user.email, libraries: await listMine(user.email) });
      }
      if ((request.method === 'POST' && !slug) || (request.method === 'PUT' && slug)) {
        const body = await readJson(request);
        if (body.tooLarge) return error(413, 'Request is too large.');
        if (!body.value) return error(400, 'Send the library details as JSON.');
        return slug ? await update(user, slug, body.value) : await register(user, body.value);
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
