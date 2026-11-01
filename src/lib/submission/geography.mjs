/**
 * The suggestion form's geography question (/submit).
 *
 * Community Data Libraries collects local data: a dataset must be broken down to
 * the state level or smaller (web#42). The form asks for the smallest geographic
 * unit in the data and explains, rather than silently dropping, why national-only
 * data can't be listed. The submission-notify function uses the same rule to flag
 * submissions for review, since a bot can skip the form's script.
 */

export const GEOGRAPHY_LEVELS = [
  { value: 'point', label: 'Individual locations (addresses, facilities, sites)' },
  { value: 'tract', label: 'Census tract or block group' },
  { value: 'zip', label: 'ZIP code' },
  { value: 'city', label: 'City or town' },
  { value: 'school_district', label: 'School district' },
  { value: 'county', label: 'County' },
  { value: 'state', label: 'State' },
  { value: 'nation', label: 'National totals only (no state or local breakdown)' },
];

export const GEOGRAPHY_MISSING_MESSAGE = 'Choose the smallest geographic unit the data is broken down to.';

export const NATIONAL_ONLY_MESSAGE =
  "We can't list data that is only available as national totals. Community Data Libraries " +
  'collects local data, so a dataset needs a geographic variable at the state level or smaller, ' +
  'such as a state, county or ZIP code column. If the file has state or local rows as well as ' +
  'national totals, choose the smallest unit it has.';

/** Null when the answer meets the state-or-smaller rule, otherwise the message to show. */
export function geographyProblem(level) {
  const value = String(level ?? '').trim();
  if (value === 'nation') return NATIONAL_ONLY_MESSAGE;
  return GEOGRAPHY_LEVELS.some((option) => option.value === value) ? null : GEOGRAPHY_MISSING_MESSAGE;
}

/** The option's label, or the raw value (or "Not answered") for anything else. */
export function geographyLabel(level) {
  const value = String(level ?? '').trim();
  return GEOGRAPHY_LEVELS.find((option) => option.value === value)?.label ?? (value || 'Not answered');
}
