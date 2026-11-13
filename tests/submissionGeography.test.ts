import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  GEOGRAPHY_LEVELS,
  GEOGRAPHY_MISSING_MESSAGE,
  NATIONAL_ONLY_MESSAGE,
  geographyLabel,
  geographyProblem,
} from '../src/lib/submission/geography.mjs';

test('state level or smaller qualifies', () => {
  for (const value of ['state', 'county', 'city', 'zip', 'tract', 'school_district', 'point']) {
    assert.equal(geographyProblem(value), null, value);
  }
});

test('national-only data is refused with a reason, not silently', () => {
  assert.equal(geographyProblem('nation'), NATIONAL_ONLY_MESSAGE);
  assert.match(NATIONAL_ONLY_MESSAGE, /state level or smaller/);
});

test('a missing or unknown answer asks for one', () => {
  for (const value of [undefined, null, '', '  ', 'planet']) {
    assert.equal(geographyProblem(value), GEOGRAPHY_MISSING_MESSAGE, String(value));
  }
});

test('every option has a label, and national is the last one', () => {
  assert.equal(new Set(GEOGRAPHY_LEVELS.map((level) => level.value)).size, GEOGRAPHY_LEVELS.length);
  assert.equal(GEOGRAPHY_LEVELS.at(-1)!.value, 'nation');
  assert.equal(geographyLabel('county'), 'County');
  assert.equal(geographyLabel('planet'), 'planet');
  assert.equal(geographyLabel(undefined), 'Not answered');
});
