import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  librarySearchText,
  matchesLibraryQuery,
  normalizeSearchText,
} from '../src/lib/community/librarySearch.ts';

const knox = librarySearchText({
  name: 'Knox County Data Library',
  slug: 'knox-county',
  place_name: 'Knoxville',
  county: 'Knox County',
  state_code: 'TN',
  state_name: 'Tennessee',
  county_fips: '47093',
  description: 'Curated open data and educational data resources for Knox County, Tennessee.',
});

const dona = librarySearchText({
  name: 'Doña Ana Community Data',
  slug: 'dona-ana',
  county: 'Doña Ana County',
  state_code: 'NM',
  state_name: 'New Mexico',
  county_fips: '35013',
});

test('an empty or blank query matches every library', () => {
  assert.equal(matchesLibraryQuery(knox, ''), true);
  assert.equal(matchesLibraryQuery(knox, '   '), true);
});

test('matches by name, place, county, state and FIPS', () => {
  for (const query of ['Knox County Data', 'knoxville', 'Knox', 'TN', 'tennessee', '47093']) {
    assert.equal(matchesLibraryQuery(knox, query), true, query);
  }
});

test('every word must match, in any order and with any punctuation', () => {
  assert.equal(matchesLibraryQuery(knox, 'Knox, TN'), true);
  assert.equal(matchesLibraryQuery(knox, 'tennessee knox'), true);
  assert.equal(matchesLibraryQuery(knox, 'knox nm'), false);
  assert.equal(matchesLibraryQuery(knox, 'Davidson'), false);
});

test('accents and case are ignored', () => {
  assert.equal(matchesLibraryQuery(dona, 'dona ana'), true);
  assert.equal(matchesLibraryQuery(dona, 'DOÑA'), true);
  assert.equal(matchesLibraryQuery(dona, 'new mexico'), true);
  assert.equal(normalizeSearchText('  Doña  Ana, NM '), 'dona ana nm');
});
