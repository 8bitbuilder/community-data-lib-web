import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createVocabulary } from '../src/lib/community/geoVocabulary.mjs';
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
  PUBLIC_FIELDS,
  slugify,
} from '../src/lib/community/librarianRules.mjs';
import { parseCommunityMarkdown } from '../src/lib/community/communityFile.mjs';

const vocabulary = createVocabulary({
  vintage: 2025,
  states: [
    { geoid: '47', name: 'Tennessee', usps: 'TN' },
    { geoid: '37', name: 'North Carolina', usps: 'NC' },
  ],
  counties: [
    { geoid: '47093', name: 'Knox County', state: 'TN' },
    { geoid: '47037', name: 'Davidson County', state: 'TN' },
    { geoid: '37183', name: 'Wake County', state: 'NC' },
  ],
});

const knox = { slug: 'knox-county', name: 'Knox County Data Library', place_name: 'Knoxville', county_fips: '47093', approved: true };
const knoxEditors = ['librarian@knoxdata.org', 'helper@knoxdata.org'];
const editor = { email: 'librarian@knoxdata.org', roles: [] };
const stranger = { email: 'stranger@example.org', roles: [] };
const admin = { email: 'team@cdl.org', roles: ['admin'] };

const davidsonInput = { name: 'Davidson County Data Library', place_name: ' Nashville ', county_fips: '47037' };

const fields = (result: { errors?: { field: string | null }[] }) => (result.errors ?? []).map((e) => e.field);

// ── Registration ─────────────────────────────────────────────

test('anyone logged in can register a library and becomes its first editor', () => {
  const result = checkRegistration({ input: davidsonInput, user: { email: 'New@Example.org ', roles: [] }, existing: [knox], vocabulary });
  assert.equal(result.ok, true);
  assert.deepEqual(result.community, {
    slug: 'davidson-county-data-library',
    name: 'Davidson County Data Library',
    place_name: 'Nashville',
    county_fips: '47037',
  });
  assert.deepEqual(result.editors, ['new@example.org']);
});

test('state and county names in the input are ignored: they come from the FIPS code', () => {
  const result = checkRegistration({
    input: { ...davidsonInput, state_code: 'XX', county: 'Wrong County', zip_codes: ['1'] },
    user: stranger,
    existing: [],
    vocabulary,
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.community).sort(), ['county_fips', 'name', 'place_name', 'slug']);
});

test('registration needs a login', () => {
  assert.equal(checkRegistration({ input: davidsonInput, user: null, existing: [], vocabulary }).status, 403);
  assert.equal(checkRegistration({ input: davidsonInput, user: { email: '' }, existing: [], vocabulary }).status, 403);
});

test('the county must be a county in the Census vocabulary', () => {
  for (const county_fips of ['', '4709', '47O93', '47000', '47999', '09001']) {
    const result = checkRegistration({ input: { ...davidsonInput, county_fips }, user: stranger, existing: [], vocabulary });
    assert.equal(result.status, 400, county_fips);
    assert.deepEqual(fields(result), ['county_fips'], county_fips);
  }
});

test('a slug or county that is already taken is a 409, pointing at the other library', () => {
  const slugTaken = checkRegistration({ input: { ...davidsonInput, slug: 'knox-county' }, user: stranger, existing: [knox], vocabulary });
  assert.equal(slugTaken.status, 409);
  assert.deepEqual(fields(slugTaken), ['slug']);

  const countyTaken = checkRegistration({ input: { ...davidsonInput, county_fips: '47093' }, user: stranger, existing: [knox], vocabulary });
  assert.equal(countyTaken.status, 409);
  assert.match(countyTaken.errors[0].message, /already has a library: Knox County Data Library/);
  assert.deepEqual(countyTaken.errors[0].existing, { slug: 'knox-county', name: 'Knox County Data Library', pending: false });

  const pending = { slug: 'davidson', name: 'Davidson', county_fips: '47037', approved: false };
  const waiting = checkRegistration({ input: davidsonInput, user: stranger, existing: [pending], vocabulary });
  assert.match(waiting.errors[0].message, /awaiting approval/);
  assert.equal(waiting.errors[0].existing.pending, true);
});

test('invalid fields are reported together', () => {
  const result = checkRegistration({
    input: { name: '', slug: 'Bad Slug!', county_fips: '47037', description: 'x'.repeat(501) },
    user: stranger,
    existing: [],
    vocabulary,
  });
  assert.equal(result.status, 400);
  assert.deepEqual(fields(result).sort(), ['description', 'name', 'slug']);
});

// ── Editing ──────────────────────────────────────────────────

const edit = (input: Record<string, unknown>, user = editor, existing: object[] = []) =>
  checkUpdate({ current: knox, editors: knoxEditors, input: { ...knox, ...input }, user, existing, vocabulary });

test('editors can edit their library (case-insensitive email) but never its slug', () => {
  const result = edit({ description: 'Updated', slug: 'new-slug' }, { email: 'LIBRARIAN@knoxdata.org', roles: [] });
  assert.equal(result.ok, true);
  assert.equal(result.community.description, 'Updated');
  assert.equal(result.community.slug, 'knox-county');
});

test('people who are not editors cannot edit, admins included', () => {
  assert.equal(edit({ name: 'Taken over' }, stranger).status, 403);
  assert.equal(edit({ name: 'Taken over' }, admin).status, 403);
});

test('moving a library to a county another library has is a 409', () => {
  const davidson = { slug: 'davidson', name: 'Davidson Library', county_fips: '47037', approved: true };
  assert.equal(edit({ county_fips: '47037' }, editor, [davidson]).status, 409);
  assert.equal(edit({ county_fips: '37183' }, editor, [davidson]).ok, true);
});

// ── Editors ──────────────────────────────────────────────────

test('editors can add editors; duplicates, bad emails and outsiders are refused', () => {
  assert.deepEqual(checkAddEditor({ editors: knoxEditors, user: editor, email: ' Teacher@School.edu ' }), { ok: true, email: 'teacher@school.edu' });
  assert.equal(checkAddEditor({ editors: knoxEditors, user: editor, email: 'HELPER@knoxdata.org' }).status, 409);
  assert.equal(checkAddEditor({ editors: knoxEditors, user: editor, email: 'not an email' }).status, 400);
  assert.equal(checkAddEditor({ editors: knoxEditors, user: stranger, email: 'x@y.org' }).status, 403);
  const full = Array.from({ length: 10 }, (_, i) => `e${i}@x.org`);
  assert.equal(checkAddEditor({ editors: full, user: { email: 'e0@x.org' }, email: 'new@x.org' }).status, 400);
});

test('editors can remove editors, themselves included, but never the last one', () => {
  assert.deepEqual(checkRemoveEditor({ editors: knoxEditors, user: editor, email: 'Helper@knoxdata.org' }), { ok: true, email: 'helper@knoxdata.org' });
  assert.equal(checkRemoveEditor({ editors: knoxEditors, user: editor, email: 'librarian@knoxdata.org' }).ok, true);
  assert.equal(checkRemoveEditor({ editors: ['solo@x.org'], user: { email: 'solo@x.org' }, email: 'solo@x.org' }).status, 409);
  assert.equal(checkRemoveEditor({ editors: knoxEditors, user: editor, email: 'nobody@x.org' }).status, 404);
  assert.equal(checkRemoveEditor({ editors: knoxEditors, user: stranger, email: 'helper@knoxdata.org' }).status, 403);
});

// ── Approval ─────────────────────────────────────────────────

test('only admins approve or reject, and only libraries that are waiting', () => {
  const pending = { ...knox, approved: false };
  assert.equal(isAdmin(admin), true);
  assert.equal(isAdmin(editor), false);
  assert.deepEqual(checkReview({ user: admin, community: pending }), { ok: true });
  assert.equal(checkReview({ user: editor, community: pending }).status, 403);
  assert.equal(checkReview({ user: admin, community: knox }).status, 409);
  assert.equal(checkReview({ user: admin, community: null }).status, 404);
});

test('only writes that change public pages rebuild the site', () => {
  assert.match(rebuildReason('approve', knox)!, /Approve community library knox-county/);
  assert.match(rebuildReason('update', knox)!, /Update community library knox-county/);
  assert.equal(rebuildReason('update', { ...knox, approved: false }), null);
  // An update that leaves every public field as it was does not rebuild; null and '' are the same.
  assert.equal(rebuildReason('update', knox, { ...knox }), null);
  assert.equal(rebuildReason('update', { ...knox, description: null }, { ...knox, description: '' }), null);
  for (const field of PUBLIC_FIELDS) {
    assert.match(rebuildReason('update', knox, { ...knox, [field]: 'before' })!, /Update community library/, field);
  }
  for (const action of ['register', 'reject', 'add-editor', 'remove-editor'] as const) {
    assert.equal(rebuildReason(action, knox), null, action);
  }
});

// ── Requests ─────────────────────────────────────────────────

test('writes must come from this site (the login is a cookie)', () => {
  const request = (origin?: string) =>
    new Request('https://cdl.example/api/librarian/libraries', { method: 'POST', headers: origin ? { Origin: origin } : {} });
  assert.equal(isAllowedOrigin(request('https://cdl.example')), true);
  assert.equal(isAllowedOrigin(request('https://evil.example')), false);
  assert.equal(isAllowedOrigin(request()), false);
  assert.equal(isAllowedOrigin(request('https://preview.cdl.example'), ['https://preview.cdl.example']), true);
});

test('helpers', () => {
  assert.equal(slugify('  Café Library, Knox!  '), 'cafe-library-knox');
  assert.equal(isEditor(knoxEditors, ' HELPER@knoxdata.org'), true);
  assert.equal(isEditor(knoxEditors, ''), false);
  const { data } = parseCommunityMarkdown('---\nname: Knox\ncounty_fips: 47093\nlibrarian_emails: [a@b.org]\n---\nBody');
  assert.deepEqual(data, { name: 'Knox', county_fips: '47093' });
});
