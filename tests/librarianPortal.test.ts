import { test } from 'node:test';
import assert from 'node:assert/strict';

import { countyLabel, editSlugFromLocation, safeNext, searchCounties, type CountyOption } from '../src/lib/librarian/portal.ts';

test('after login, only librarian portal pages are allowed as the next page', () => {
  assert.equal(safeNext('/web/librarian/register/', '/web/librarian/'), '/web/librarian/register/');
  assert.equal(safeNext('/web/librarian/knox-county/edit/', '/web/librarian'), '/web/librarian/knox-county/edit/');
  for (const bad of [null, '', 'https://evil.example/', '//evil.example/web/librarian/', '/web/maps/', '/web/librarian/\\evil']) {
    assert.equal(safeNext(bad, '/web/librarian/'), '/web/librarian/', String(bad));
  }
});

test('the edit page finds its library in the path or, locally, in ?slug=', () => {
  assert.equal(editSlugFromLocation('/web/librarian/knox-county/edit/', ''), 'knox-county');
  assert.equal(editSlugFromLocation('/web/librarian/knox-county/edit', ''), 'knox-county');
  assert.equal(editSlugFromLocation('/web/librarian/edit/', '?slug=Knox-County'), 'knox-county');
  assert.equal(editSlugFromLocation('/web/librarian/edit/', '?slug=../etc'), null);
  assert.equal(editSlugFromLocation('/web/librarian/edit/', ''), null);
});

const options: CountyOption[] = [
  ['47093', 'Knox County', 'Tennessee', 'TN'],
  ['18083', 'Knox County', 'Indiana', 'IN'],
  ['47105', 'Loudon County', 'Tennessee', 'TN'],
  ['35013', 'Doña Ana County', 'New Mexico', 'NM'],
  ['51760', 'Richmond city', 'Virginia', 'VA'],
];

test('county search matches every word against county, state, code and FIPS', () => {
  assert.deepEqual(searchCounties(options, 'knox').map(countyLabel), ['Knox County, Indiana', 'Knox County, Tennessee']);
  assert.deepEqual(searchCounties(options, 'knox tn').map((o) => o[0]), ['47093']);
  assert.deepEqual(searchCounties(options, 'Knox, Tennessee').map((o) => o[0]), ['47093']);
  assert.deepEqual(searchCounties(options, '47093').map((o) => o[0]), ['47093']);
  assert.deepEqual(searchCounties(options, 'dona ana').map((o) => o[0]), ['35013']);
  assert.deepEqual(searchCounties(options, 'tennessee').map((o) => o[0]), ['47093', '47105']);
  assert.deepEqual(searchCounties(options, '   '), []);
  assert.equal(searchCounties(options, 'county', 2).length, 2);
});
