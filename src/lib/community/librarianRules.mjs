/**
 * Who may register and edit community libraries, and what a valid library looks like.
 *
 * Pure functions only (no I/O) so the rules can be unit-tested and shared by the
 * librarian Netlify Function (netlify/functions/librarian-api.mjs) and the
 * /librarian/ page. Results use HTTP-style statuses: 400 invalid input,
 * 403 not a librarian of this library, 409 slug or county already registered.
 */

/** Two-digit state FIPS codes; a county FIPS code starts with its state's code. */
export const STATE_FIPS = {
  AL: '01', AK: '02', AZ: '04', AR: '05', CA: '06', CO: '08', CT: '09', DE: '10',
  DC: '11', FL: '12', GA: '13', HI: '15', ID: '16', IL: '17', IN: '18', IA: '19',
  KS: '20', KY: '21', LA: '22', ME: '23', MD: '24', MA: '25', MI: '26', MN: '27',
  MS: '28', MO: '29', MT: '30', NE: '31', NV: '32', NH: '33', NJ: '34', NM: '35',
  NY: '36', NC: '37', ND: '38', OH: '39', OK: '40', OR: '41', PA: '42', RI: '44',
  SC: '45', SD: '46', TN: '47', TX: '48', UT: '49', VT: '50', VA: '51', WA: '53',
  WV: '54', WI: '55', WY: '56',
};

export const LIMITS = {
  name: 100,
  placeName: 60,
  county: 60,
  description: 500,
  slug: 60,
  zipCodes: 100,
  librarianEmails: 10,
};

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_PATTERN = /^\d{5}$/;
const FIPS_PATTERN = /^\d{5}$/;

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

/** Whether `email` is one of the community's librarians (case-insensitive). */
export function isLibrarian(community, email) {
  const target = normalizeEmail(email);
  if (!target) return false;
  return (community?.librarian_emails ?? []).some((e) => normalizeEmail(e) === target);
}

function text(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed === '' ? undefined : trimmed;
}

function list(value) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(/[\s,;]+/);
  return items.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function uniqueEmails(value) {
  return [...new Set(list(value).map(normalizeEmail))];
}

/**
 * Turn form input into a community record (trimmed, deduplicated, canonical
 * key order). Does not validate; see validateCommunity.
 */
export function buildCommunity(input, { slug, librarianEmails }) {
  const community = {
    name: text(input.name),
    place_name: text(input.place_name),
    slug,
    description: text(input.description),
    state_code: text(input.state_code)?.toUpperCase(),
    county: text(input.county),
    county_fips: text(input.county_fips),
    zip_codes: [...new Set(list(input.zip_codes))],
    librarian_emails: uniqueEmails(librarianEmails),
  };
  for (const key of Object.keys(community)) {
    if (community[key] === undefined) delete community[key];
  }
  return community;
}

/** Field-level problems with a community record, as [{ field, message }]. */
export function validateCommunity(community) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const tooLong = (field, value, max) => {
    if (value && value.length > max) add(field, `Must be ${max} characters or fewer.`);
  };

  if (!community.name) add('name', 'Library name is required.');
  tooLong('name', community.name, LIMITS.name);
  tooLong('place_name', community.place_name, LIMITS.placeName);
  tooLong('county', community.county, LIMITS.county);
  tooLong('description', community.description, LIMITS.description);

  if (!community.slug) {
    add('slug', 'Web address (slug) is required.');
  } else if (!SLUG_PATTERN.test(community.slug) || community.slug.length > LIMITS.slug) {
    add('slug', 'Use lowercase letters, numbers, and single hyphens (up to 60 characters).');
  }

  const stateFips = STATE_FIPS[community.state_code ?? ''];
  if (!stateFips) add('state_code', 'Choose a U.S. state or DC.');

  const fips = community.county_fips;
  if (!fips) {
    add('county_fips', 'County FIPS code is required.');
  } else if (!FIPS_PATTERN.test(fips) || fips.endsWith('000')) {
    add('county_fips', 'County FIPS must be five digits, e.g. 47093 for Knox County, TN.');
  } else if (stateFips && !fips.startsWith(stateFips)) {
    add(
      'county_fips',
      `County FIPS must start with ${stateFips}, the code for ${community.state_code}.`,
    );
  }

  const badZips = community.zip_codes.filter((zip) => !ZIP_PATTERN.test(zip));
  if (badZips.length > 0) add('zip_codes', `Not 5-digit ZIP codes: ${badZips.join(', ')}.`);
  if (community.zip_codes.length > LIMITS.zipCodes) {
    add('zip_codes', `At most ${LIMITS.zipCodes} ZIP codes.`);
  }

  const emails = community.librarian_emails;
  if (emails.length === 0) add('librarian_emails', 'A library needs at least one librarian.');
  if (emails.length > LIMITS.librarianEmails) {
    add('librarian_emails', `At most ${LIMITS.librarianEmails} librarians.`);
  }
  const badEmails = emails.filter((email) => !isValidEmail(email));
  if (badEmails.length > 0) add('librarian_emails', `Not valid emails: ${badEmails.join(', ')}.`);

  return errors;
}

/** Slug/county clashes with other registered libraries (`existing` excludes the one being edited). */
function findDuplicates(community, existing) {
  const errors = [];
  if (existing.some((other) => other.slug === community.slug)) {
    errors.push({ field: 'slug', message: `The web address "${community.slug}" is already taken.` });
  }
  const clash = existing.find(
    (other) => community.county_fips && other.county_fips === community.county_fips,
  );
  if (clash) {
    errors.push({
      field: 'county_fips',
      message: `County ${community.county_fips} already has a library: ${clash.name}. Contact its librarians instead.`,
    });
  }
  return errors;
}

function result(community, errors, duplicates) {
  if (errors.length > 0) return { ok: false, status: 400, errors };
  if (duplicates.length > 0) return { ok: false, status: 409, errors: duplicates };
  return { ok: true, community };
}

/**
 * A new library registered by `email` (a verified login). The registrant becomes its
 * first librarian; the slug defaults to the slugified library name.
 */
export function checkRegistration({ input, email, existing }) {
  if (!isValidEmail(email)) {
    return { ok: false, status: 403, errors: [{ field: null, message: 'Log in to register a library.' }] };
  }
  const slug = text(input.slug)?.toLowerCase() ?? slugify(input.name);
  const community = buildCommunity(input, { slug, librarianEmails: [email] });
  return result(community, validateCommunity(community), findDuplicates(community, existing));
}

/**
 * An edit to `current` by `email`. Only its librarians may edit it; the slug never
 * changes; librarian emails may be added or removed but at least one must remain.
 */
export function checkUpdate({ current, input, email, existing }) {
  if (!isLibrarian(current, email)) {
    return {
      ok: false,
      status: 403,
      errors: [{ field: null, message: 'Only this library’s librarians can edit it.' }],
    };
  }
  const librarianEmails = input.librarian_emails ?? current.librarian_emails;
  const community = buildCommunity(input, { slug: current.slug, librarianEmails });
  const others = existing.filter((other) => other.slug !== current.slug);
  return result(community, validateCommunity(community), findDuplicates(community, others));
}
