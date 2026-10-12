import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  checkRegistration,
  checkUpdate,
  isLibrarian,
  slugify,
} from '../src/lib/community/librarianRules.mjs';
import {
  communityPath,
  parseCommunityMarkdown,
  serializeCommunityMarkdown,
} from '../src/lib/community/communityFile.mjs';

const knox = {
  name: 'Knox County Data Library',
  place_name: 'Knoxville',
  slug: 'knox-county',
  state_code: 'TN',
  county: 'Knox County',
  county_fips: '47093',
  zip_codes: ['37901', '37902'],
  librarian_emails: ['librarian@knoxdata.org', 'helper@knoxdata.org'],
};

const davidsonInput = {
  name: 'Davidson County Data Library',
  place_name: 'Nashville',
  state_code: 'tn',
  county_fips: '47037',
  zip_codes: '37201, 37203 37203',
};

const editOf = (community: typeof knox, changes: Record<string, unknown> = {}) => ({
  ...community,
  ...changes,
});

const errorFields = (result: { errors?: { field: string | null }[] }) =>
  (result.errors ?? []).map((e) => e.field);

// ── Registration ─────────────────────────────────────────────

test('a logged-in user registers a library and becomes its first librarian', () => {
  const result = checkRegistration({ input: davidsonInput, email: 'New@Example.org ', existing: [knox] });
  assert.equal(result.ok, true);
  assert.deepEqual(result.community, {
    name: 'Davidson County Data Library',
    place_name: 'Nashville',
    slug: 'davidson-county-data-library',
    state_code: 'TN',
    county_fips: '47037',
    zip_codes: ['37201', '37203'],
    librarian_emails: ['new@example.org'],
  });
});

test('registration is rejected when the slug is already registered', () => {
  const result = checkRegistration({
    input: { ...davidsonInput, slug: 'knox-county' },
    email: 'new@example.org',
    existing: [knox],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(errorFields(result), ['slug']);
});

test('registration is rejected when the county FIPS is already registered', () => {
  const result = checkRegistration({
    input: { ...davidsonInput, name: 'Another Knox Library', county_fips: '47093' },
    email: 'new@example.org',
    existing: [knox],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(errorFields(result), ['county_fips']);
  assert.match(result.errors[0].message, /Knox County Data Library/);
});

test('bad county FIPS codes are rejected', () => {
  for (const county_fips of ['4709', '47O93', '470930', '47000', '']) {
    const result = checkRegistration({
      input: { ...davidsonInput, county_fips },
      email: 'new@example.org',
      existing: [],
    });
    assert.equal(result.status, 400, county_fips);
    assert.deepEqual(errorFields(result), ['county_fips'], county_fips);
  }
});

test('a county FIPS from a different state is rejected', () => {
  const result = checkRegistration({
    input: { ...davidsonInput, county_fips: '37183' },
    email: 'new@example.org',
    existing: [],
  });
  assert.equal(result.status, 400);
  assert.match(result.errors[0].message, /start with 47/);
});

test('other invalid fields are reported together', () => {
  const result = checkRegistration({
    input: { name: '', state_code: 'XX', county_fips: '47037', zip_codes: ['3720', 'abcde'] },
    email: 'new@example.org',
    existing: [],
  });
  assert.equal(result.status, 400);
  assert.deepEqual(errorFields(result).sort(), ['name', 'slug', 'state_code', 'zip_codes']);
});

test('registration requires a verified login email', () => {
  const result = checkRegistration({ input: davidsonInput, email: '', existing: [] });
  assert.equal(result.status, 403);
});

// ── Editing ──────────────────────────────────────────────────

test('a librarian can edit their library, case-insensitively', () => {
  const result = checkUpdate({
    current: knox,
    input: editOf(knox, { description: 'Updated' }),
    email: 'LIBRARIAN@knoxdata.org',
    existing: [knox],
  });
  assert.equal(result.ok, true);
  assert.equal(result.community.description, 'Updated');
});

test('someone who is not a librarian of the library cannot edit it', () => {
  const result = checkUpdate({
    current: knox,
    input: editOf(knox, { name: 'Taken over' }),
    email: 'stranger@example.org',
    existing: [knox],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('librarians can add and remove other librarians', () => {
  const result = checkUpdate({
    current: knox,
    input: editOf(knox, { librarian_emails: ['librarian@knoxdata.org', 'teacher@school.edu'] }),
    email: 'helper@knoxdata.org',
    existing: [knox],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.community.librarian_emails, ['librarian@knoxdata.org', 'teacher@school.edu']);
});

test('the last librarian email cannot be removed', () => {
  const result = checkUpdate({
    current: knox,
    input: editOf(knox, { librarian_emails: [] }),
    email: 'librarian@knoxdata.org',
    existing: [knox],
  });
  assert.equal(result.status, 400);
  assert.deepEqual(errorFields(result), ['librarian_emails']);
});

test('an edit cannot change the slug or take another library’s county', () => {
  const davidson = { ...knox, name: 'Davidson', slug: 'davidson', county_fips: '47037' };
  const renamed = checkUpdate({
    current: knox,
    input: editOf(knox, { slug: 'somewhere-else' }),
    email: 'librarian@knoxdata.org',
    existing: [knox, davidson],
  });
  assert.equal(renamed.ok, true);
  assert.equal(renamed.community.slug, 'knox-county');

  const clash = checkUpdate({
    current: knox,
    input: editOf(knox, { county_fips: '47037' }),
    email: 'librarian@knoxdata.org',
    existing: [knox, davidson],
  });
  assert.equal(clash.status, 409);
  assert.deepEqual(errorFields(clash), ['county_fips']);
});

test('isLibrarian and slugify handle edge cases', () => {
  assert.equal(isLibrarian({ librarian_emails: [] }, ''), false);
  assert.equal(isLibrarian(undefined, 'a@b.org'), false);
  assert.equal(slugify('  Ñandú County: Data Library!  '), 'nandu-county-data-library');
});

// ── Community files ──────────────────────────────────────────

test('the Knox County file parses and round-trips', async () => {
  const markdown = await readFile(new URL('../src/content/communities/knox-county.md', import.meta.url), 'utf8');
  const { data, body } = parseCommunityMarkdown(markdown);
  assert.equal(data.county_fips, '47093');
  assert.deepEqual(data.librarian_emails, ['librarian@knoxdata.org']);

  const again = parseCommunityMarkdown(serializeCommunityMarkdown(data, body));
  assert.deepEqual(again.data, data);
  assert.equal(again.body.trim(), body.trim());
});

test('old single librarian_email files are read as a list', () => {
  const { data } = parseCommunityMarkdown(
    '---\nname: X\nslug: x\nstate_code: TN\ncounty_fips: 47093\nlibrarian_email: a@b.org\n---\nBody\n',
  );
  assert.deepEqual(data.librarian_emails, ['a@b.org']);
  assert.equal(data.librarian_email, undefined);
  assert.equal(data.county_fips, '47093');
});

test('community paths only accept safe slugs', () => {
  assert.equal(communityPath('knox-county'), 'src/content/communities/knox-county.md');
  assert.throws(() => communityPath('../../netlify.toml'));
  assert.throws(() => communityPath('Knox County'));
});
