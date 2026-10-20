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
};
const knoxLibrarians = ['librarian@knoxdata.org', 'helper@knoxdata.org'];

const davidsonInput = {
  name: 'Davidson County Data Library',
  place_name: 'Nashville',
  state_code: 'tn',
  county_fips: '47037',
  zip_codes: '37201, 37203 37203',
};

const errorFields = (result: { errors?: { field: string | null }[] }) =>
  (result.errors ?? []).map((e) => e.field);

const edit = (changes: Record<string, unknown>, email = 'librarian@knoxdata.org', existing = [knox]) =>
  checkUpdate({ current: knox, librarians: knoxLibrarians, input: { ...knox, ...changes }, email, existing });

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
  });
  assert.deepEqual(result.librarians, ['new@example.org']);
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

test('registration is rejected when the county FIPS is already registered, pointing to that library', () => {
  const result = checkRegistration({
    input: { ...davidsonInput, name: 'Another Knox Library', county_fips: '47093' },
    email: 'new@example.org',
    existing: [knox],
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(errorFields(result), ['county_fips']);
  assert.match(result.errors[0].message, /Knox County Data Library/);
  assert.deepEqual(result.errors[0].existing, { slug: 'knox-county', name: 'Knox County Data Library', pending: false });
});

test('a county awaiting approval also blocks a second registration', () => {
  const pending = { slug: 'davidson', name: 'Davidson', county_fips: '47037', pending: true };
  const result = checkRegistration({ input: davidsonInput, email: 'new@example.org', existing: [pending] });
  assert.equal(result.status, 409);
  assert.match(result.errors[0].message, /awaiting approval/);
  assert.equal(result.errors[0].existing.pending, true);
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
  const result = edit({ description: 'Updated' }, 'LIBRARIAN@knoxdata.org');
  assert.equal(result.ok, true);
  assert.equal(result.community.description, 'Updated');
  assert.deepEqual(result.librarians, knoxLibrarians);
});

test('someone who is not a librarian of the library cannot edit it', () => {
  const result = edit({ name: 'Taken over' }, 'stranger@example.org');
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
});

test('librarians can add and remove other librarians', () => {
  const result = edit(
    { librarian_emails: ['librarian@knoxdata.org', 'Teacher@School.edu'] },
    'helper@knoxdata.org',
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.librarians, ['librarian@knoxdata.org', 'teacher@school.edu']);
  assert.equal('librarian_emails' in result.community, false);
});

test('the last librarian email cannot be removed, and bad emails are rejected', () => {
  const empty = edit({ librarian_emails: [] });
  assert.equal(empty.status, 400);
  assert.deepEqual(errorFields(empty), ['librarian_emails']);

  const bad = edit({ librarian_emails: ['librarian@knoxdata.org', 'not-an-email'] });
  assert.equal(bad.status, 400);
  assert.match(bad.errors[0].message, /not-an-email/);
});

test('an edit cannot change the slug or take another library’s county', () => {
  const davidson = { ...knox, name: 'Davidson', slug: 'davidson', county_fips: '47037' };
  const renamed = edit({ slug: 'somewhere-else' }, undefined, [knox, davidson]);
  assert.equal(renamed.ok, true);
  assert.equal(renamed.community.slug, 'knox-county');

  const clash = edit({ county_fips: '47037' }, undefined, [knox, davidson]);
  assert.equal(clash.status, 409);
  assert.deepEqual(errorFields(clash), ['county_fips']);
});

test('isLibrarian and slugify handle edge cases', () => {
  assert.equal(isLibrarian([], ''), false);
  assert.equal(isLibrarian(undefined, 'a@b.org'), false);
  assert.equal(isLibrarian(['A@B.org'], ' a@b.org '), true);
  assert.equal(slugify('  Ñandú County: Data Library!  '), 'nandu-county-data-library');
});

// ── Community files ──────────────────────────────────────────

test('the Knox County file parses, round-trips, and holds no emails', async () => {
  const markdown = await readFile(new URL('../src/content/communities/knox-county.md', import.meta.url), 'utf8');
  assert.doesNotMatch(markdown, /@/);
  const { data, body } = parseCommunityMarkdown(markdown);
  assert.equal(data.county_fips, '47093');

  const again = parseCommunityMarkdown(serializeCommunityMarkdown(data, body));
  assert.deepEqual(again.data, data);
  assert.equal(again.body.trim(), body.trim());
});

test('old librarian email fields are dropped and never written back', () => {
  const { data } = parseCommunityMarkdown(
    '---\nname: X\nslug: x\nstate_code: TN\ncounty_fips: 47093\nlibrarian_email: a@b.org\nlibrarian_emails: [c@d.org]\n---\nBody\n',
  );
  assert.equal(data.librarian_email, undefined);
  assert.equal(data.librarian_emails, undefined);
  assert.equal(data.county_fips, '47093');
  assert.doesNotMatch(serializeCommunityMarkdown({ ...data, librarian_emails: ['c@d.org'] }, ''), /@/);
});

test('community paths only accept safe slugs', () => {
  assert.equal(communityPath('knox-county'), 'src/content/communities/knox-county.md');
  assert.throws(() => communityPath('../../netlify.toml'));
  assert.throws(() => communityPath('Knox County'));
});
