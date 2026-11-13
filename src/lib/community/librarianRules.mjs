/**
 * Who may change community libraries, and what a valid library looks like.
 *
 * Pure functions only (no I/O) so the rules can be unit-tested and shared by the
 * librarian Netlify Function (netlify/functions/librarian-api.mjs) and the
 * /librarian/ pages. Results use HTTP-style statuses: 400 invalid input,
 * 403 not allowed, 404 not found, 409 conflicts (slug or county taken, last editor).
 *
 * Users are { email, roles } from a Netlify Identity login. Editors of a library
 * are the emails in community_editors; anyone logged in may register a library
 * (and becomes its first editor); only users with the Identity role "admin"
 * approve or reject new libraries.
 */

import { describeCounty } from './geoVocabulary.mjs';
import { isReservedSlug } from './libraryHosts.mjs';

/**
 * Two-digit state FIPS codes. Only the pre-database librarian page still uses this;
 * county codes are now checked against the Census vocabulary instead.
 */
export const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56',
};

// Mirrors the CHECK constraints in netlify/database/migrations.
export const LIMITS = {
  name: 100,
  placeName: 60,
  description: 500,
  slug: 60,
  editors: 10,
};

export const ADMIN_ROLE = 'admin';
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function isValidEmail(email) {
  const value = normalizeEmail(email);
  return value.length <= 254 && EMAIL_PATTERN.test(value);
}

export function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/, '');
}

/** Whether `email` is one of `editors` (case-insensitive). */
export function isEditor(editors, email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return (editors ?? []).some((e) => normalizeEmail(e) === target);
}

export function isAdmin(user) {
  return Boolean(user?.roles?.includes(ADMIN_ROLE));
}

function text(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Turn form input into a community record (trimmed, canonical key order).
 * Does not validate; see validateCommunity. State and county names are never
 * taken from input: they are derived from county_fips.
 */
export function buildCommunity(input, { slug }) {
  const community = {
    slug,
    name: text(input.name),
    place_name: text(input.place_name),
    description: text(input.description),
    county_fips: text(input.county_fips),
  };
  for (const key of Object.keys(community)) {
    if (community[key] === undefined) delete community[key];
  }
  return community;
}

/** Field-level problems with a community record, as [{ field, message }]. */
export function validateCommunity(community, vocabulary) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const tooLong = (field, value, max) => {
    if (value && value.length > max) add(field, `Must be ${max} characters or fewer.`);
  };

  if (!community.name) add('name', 'Library name is required.');
  tooLong('name', community.name, LIMITS.name);
  tooLong('place_name', community.place_name, LIMITS.placeName);
  tooLong('description', community.description, LIMITS.description);

  if (!community.slug) {
    add('slug', 'Web address (slug) is required.');
  } else if (!SLUG_PATTERN.test(community.slug) || community.slug.length > LIMITS.slug) {
    add('slug', 'Use lowercase letters, numbers, and single hyphens (up to 60 characters).');
  } else if (isReservedSlug(community.slug)) {
    // The slug is also the library's subdomain (web#31).
    add('slug', `"${community.slug}" is reserved. Choose another web address.`);
  }

  if (!community.county_fips) {
    add('county_fips', 'Choose your county.');
  } else if (!describeCounty(vocabulary, community.county_fips)) {
    add('county_fips', `${community.county_fips} is not a U.S. county code in the ${vocabulary.vintage} Census list. Choose your county from the list.`);
  }
  return errors;
}

/**
 * Slug/county clashes with other libraries, approved or pending (`existing`
 * excludes the one being edited). County clashes carry the other library so the
 * page can point people to it.
 *
 * @param {{ slug: string, name: string, county_fips: string, approved: boolean }[]} existing
 */
function findDuplicates(community, existing) {
  const errors = [];
  if (existing.some((other) => other.slug === community.slug)) {
    errors.push({ field: 'slug', message: `The web address "${community.slug}" is already taken.` });
  }
  const clash = existing.find((other) => community.county_fips && other.county_fips === community.county_fips);
  if (clash) {
    errors.push({
      field: 'county_fips',
      message: clash.approved
        ? `This county already has a library: ${clash.name}. Ask its editors to add you instead.`
        : `A library for this county is already awaiting approval: ${clash.name}.`,
      existing: { slug: clash.slug, name: clash.name, pending: !clash.approved },
    });
  }
  return errors;
}

const deny = (status, message, field = null) => ({ ok: false, status, errors: [{ field, message }] });

function result(fields, errors, duplicates) {
  if (errors.length > 0) return { ok: false, status: 400, errors };
  if (duplicates.length > 0) return { ok: false, status: 409, errors: duplicates };
  return { ok: true, ...fields };
}

/**
 * A new library registered by a logged-in `user`. The registrant becomes its first
 * editor; the slug defaults to the slugified library name. New libraries wait for
 * an admin's approval before they are built into the site.
 */
export function checkRegistration({ input, user, existing, vocabulary }) {
  if (!isValidEmail(user?.email)) return deny(403, 'Log in to register a library.');
  const slug = text(input.slug)?.toLowerCase() ?? slugify(input.name);
  const community = buildCommunity(input, { slug });
  return result(
    { community, editors: [normalizeEmail(user.email)] },
    validateCommunity(community, vocabulary),
    findDuplicates(community, existing)
  );
}

/** An edit to `current` by `user`. Only its editors may edit it, and the slug never changes. */
export function checkUpdate({ current, editors, input, user, existing, vocabulary }) {
  if (!isEditor(editors, user?.email)) return deny(403, 'Only this library’s editors can edit it.');
  const community = buildCommunity(input, { slug: current.slug });
  const others = existing.filter((other) => other.slug !== current.slug);
  return result({ community }, validateCommunity(community, vocabulary), findDuplicates(community, others));
}

/** Adding `email` as an editor; only existing editors may add one. */
export function checkAddEditor({ editors, user, email }) {
  if (!isEditor(editors, user?.email)) return deny(403, 'Only this library’s editors can add editors.');
  const target = normalizeEmail(email);
  if (!isValidEmail(target)) return deny(400, 'Enter a valid email address.', 'email');
  if (isEditor(editors, target)) return deny(409, `${target} is already an editor.`, 'email');
  if (editors.length >= LIMITS.editors) return deny(400, `A library can have at most ${LIMITS.editors} editors.`, 'email');
  return { ok: true, email: target };
}

/** Removing `email` as an editor (editors may remove themselves); a library keeps at least one. */
export function checkRemoveEditor({ editors, user, email }) {
  if (!isEditor(editors, user?.email)) return deny(403, 'Only this library’s editors can remove editors.');
  const target = normalizeEmail(email);
  if (!isEditor(editors, target)) return deny(404, `${target} is not an editor of this library.`, 'email');
  if (editors.length <= 1) return deny(409, 'A library needs at least one editor. Add another editor first.', 'email');
  return { ok: true, email: target };
}

/** Approving or rejecting a library that is waiting for approval: admins only. */
export function checkReview({ user, community }) {
  if (!isAdmin(user)) return deny(403, 'Only the Community Data Libraries team can approve libraries.');
  if (!community) return deny(404, 'No such library.');
  if (community.approved) return deny(409, 'This library is already approved.');
  return { ok: true };
}

/** The fields of an approved library that its public page shows (the ones `communityDb.update` writes). */
export const PUBLIC_FIELDS = ['name', 'place_name', 'description', 'county_fips'];

/**
 * Whether a write changes the public site, so the static pages must be rebuilt
 * (each rebuild is a production deploy). Pending libraries and editor lists are
 * not public, so changing them does not rebuild, and neither does an update that
 * leaves every public field as it was.
 *
 * @param {'register' | 'update' | 'approve' | 'reject' | 'add-editor' | 'remove-editor'} action
 * @param {object} community the library after the write
 * @param {object} [previous] the library before an update
 * @returns {string | null} a short reason for the build log, or null for no rebuild
 */
export function rebuildReason(action, community, previous) {
  if (action === 'approve') return `Approve community library ${community.slug}`;
  if (action !== 'update' || !community.approved) return null;
  const same = (field) => String(community[field] ?? '') === String(previous[field] ?? '');
  if (previous && PUBLIC_FIELDS.every(same)) return null;
  return `Update community library ${community.slug}`;
}

/**
 * CSRF check for state-changing requests: the login is a cookie (nf_jwt), so a
 * write must come from a page on this site. Compares the Origin header with the
 * request's own origin (plus any extra allowed origins).
 */
export function isAllowedOrigin(request, allowedOrigins = []) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  return origin === new URL(request.url).origin || allowedOrigins.includes(origin);
}
