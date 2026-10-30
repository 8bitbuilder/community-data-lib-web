/**
 * Lookups over src/data/geo-vocabulary.json, the list of state and county GEOIDs
 * written by `npm run geo:boundaries` from the Census county file that /maps draws.
 *
 * Pure functions only (the vocabulary is passed in) so the same rules run in the
 * prebuild check and tests (and later any other caller that needs them).
 */

/**
 * @typedef {{ geoid: string, name: string, usps: string }} VocabularyState
 * @typedef {{ geoid: string, name: string, state: string }} VocabularyCounty
 * @typedef {{ vintage: number, states: VocabularyState[], counties: VocabularyCounty[] }} VocabularyFile
 */

/** Index a parsed geo-vocabulary.json for lookups by GEOID. */
export function createVocabulary(/** @type {VocabularyFile} */ file) {
  const states = new Map(file.states.map((s) => [s.geoid, s]));
  const counties = new Map(file.counties.map((c) => [c.geoid, c]));
  return {
    vintage: file.vintage,
    states,
    counties,
    /** The county record, or null if the code is not a county in this vintage. */
    county(geoid) {
      return counties.get(String(geoid ?? '')) ?? null;
    },
    state(geoid) {
      return states.get(String(geoid ?? '')) ?? null;
    },
  };
}

/** Whether one coverage entry ({ level, geoid }) names a place in the vocabulary. */
export function isKnownCoverage(vocabulary, { level, geoid }) {
  if (level === 'nation') return geoid === 'US';
  if (level === 'state') return vocabulary.states.has(geoid);
  if (level === 'county') return vocabulary.counties.has(geoid);
  return false;
}

/**
 * Coverage and community FIPS codes that are not in the vocabulary.
 *
 * @param {ReturnType<typeof createVocabulary>} vocabulary
 * @param {{ datasets?: { file: string, coverage?: { level: string, geoid: string }[] }[],
 *           communities?: { file: string, county_fips?: string }[] }} input
 * @returns {{ file: string, problem: string }[]}
 */
export function findUnknownGeoids(vocabulary, { datasets = [], communities = [] }) {
  const problems = [];
  for (const { file, coverage = [] } of datasets) {
    for (const entry of coverage) {
      if (!isKnownCoverage(vocabulary, entry)) {
        problems.push({ file, problem: `coverage ${entry.level} ${entry.geoid}` });
      }
    }
  }
  for (const { file, county_fips } of communities) {
    if (!vocabulary.county(county_fips)) {
      problems.push({ file, problem: `county_fips ${county_fips ?? '(missing)'}` });
    }
  }
  return problems;
}

/**
 * State code and county name for a county FIPS, derived at read time rather than
 * stored with each community. Null if the code is not a county in this vintage.
 */
export function describeCounty(vocabulary, countyFips) {
  const county = vocabulary.county(countyFips);
  if (!county) return null;
  const state = vocabulary.state(county.geoid.slice(0, 2));
  return {
    county_fips: county.geoid,
    county: county.name,
    state_code: county.state,
    state_name: state?.name ?? county.state,
  };
}
