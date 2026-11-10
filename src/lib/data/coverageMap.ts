/**
 * Pure coverage logic for the /maps page.
 *
 * Coverage is defined by codes only (see backend source_coverage): a dataset
 * covers the nation, whole states, single counties, census tracts or ZCTAs.
 * Boundary geometry is for display; nothing here intersects shapes. The map
 * draws counties only (tract and ZCTA boundaries are far too large to ship).
 *
 * Expansion rules:
 *   nation -> every county in the boundary data
 *   state  -> every county whose GEOID starts with that state FIPS
 *   county -> that county
 *   tract  -> the county it lies in (its first 5 digits)
 *   zip    -> every county the ZCTA lies in (the `counties` the backend export
 *             lists from its Census crosswalk), so a ZCTA that crosses county
 *             lines shades each of them
 * A dataset with no coverage is "coverage unknown": it is not counted and is
 * listed separately.
 *
 * No Astro or Vite imports, so it runs in the browser bundle and under Node's
 * test runner (see tests/coverageMap.test.ts).
 */

import { entryCounties, type CoverageEntry } from './communityFilter.ts';

export type { CoverageEntry };

/** One state or county from the Census boundary files. `state` is the USPS code, e.g. 'TN'. */
export interface BoundaryArea {
  geoid: string;
  name: string;
  state: string;
}

export interface BoundaryIndex {
  states: Map<string, BoundaryArea>;
  counties: Map<string, BoundaryArea>;
  /** County GEOIDs per 2-digit state FIPS. */
  countiesByState: Map<string, string[]>;
}

/** The subset of catalog entry data the map needs. */
export interface CoverageDataset {
  id: string;
  title: string;
  coverage: CoverageEntry[];
}

export interface UnknownCoverage {
  datasetId: string;
  level: CoverageEntry['level'];
  geoid: string;
}

const LABEL_LIMIT = 3;

// Most local first when listing the datasets that cover a county.
const LEVEL_RANK: Record<CoverageEntry['level'], number> = { tract: 0, zip: 0, county: 1, state: 2, nation: 3 };
const PART_OF_COUNTY = 0;

export function buildBoundaryIndex(states: BoundaryArea[], counties: BoundaryArea[]): BoundaryIndex {
  const countiesByState = new Map<string, string[]>();
  for (const county of counties) {
    const stateFips = county.geoid.slice(0, 2);
    const list = countiesByState.get(stateFips) ?? [];
    list.push(county.geoid);
    countiesByState.set(stateFips, list);
  }
  return {
    states: new Map(states.map((s) => [s.geoid, s])),
    counties: new Map(counties.map((c) => [c.geoid, c])),
    countiesByState,
  };
}

/** County GEOIDs a coverage list describes. Codes missing from the index are ignored. */
export function expandCoverage(coverage: CoverageEntry[], index: BoundaryIndex): Set<string> {
  const result = new Set<string>();
  for (const entry of coverage) {
    if (entry.level === 'nation') {
      for (const geoid of index.counties.keys()) result.add(geoid);
    } else if (entry.level === 'state') {
      for (const geoid of index.countiesByState.get(entry.geoid) ?? []) result.add(geoid);
    } else {
      for (const geoid of entryCounties(entry)) if (index.counties.has(geoid)) result.add(geoid);
    }
  }
  return result;
}

export function isNational(coverage: CoverageEntry[]): boolean {
  return coverage.some((entry) => entry.level === 'nation');
}

/** Number of datasets covering each county; every county in the index is present, 0 included. */
export function countsByCounty(datasets: CoverageDataset[], index: BoundaryIndex): Map<string, number> {
  const counts = new Map<string, number>();
  for (const geoid of index.counties.keys()) counts.set(geoid, 0);
  for (const dataset of datasets) {
    for (const geoid of expandCoverage(dataset.coverage, index)) {
      counts.set(geoid, (counts.get(geoid) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * How locally a dataset covers a county (0 tract or zip, 1 county, 2 state, 3 nation),
 * or null if it doesn't.
 */
function coverageRank(coverage: CoverageEntry[], countyGeoid: string): number | null {
  let best: number | null = null;
  for (const entry of coverage) {
    const covers =
      entry.level === 'nation' ||
      (entry.level === 'state' && countyGeoid.startsWith(entry.geoid)) ||
      entryCounties(entry).includes(countyGeoid);
    if (covers && (best === null || LEVEL_RANK[entry.level] < best)) best = LEVEL_RANK[entry.level];
  }
  return best;
}

/** Datasets covering one county, most local first, then by title. */
export function datasetsForCounty<T extends CoverageDataset>(
  countyGeoid: string,
  datasets: T[],
  index: BoundaryIndex
): T[] {
  if (!index.counties.has(countyGeoid)) return [];
  return datasets
    .map((dataset) => ({ dataset, rank: coverageRank(dataset.coverage, countyGeoid) }))
    .filter((item): item is { dataset: T; rank: number } => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.dataset.title.localeCompare(b.dataset.title))
    .map((item) => item.dataset);
}

const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

function countyName(geoid: string, index: BoundaryIndex): string {
  const county = index.counties.get(geoid);
  return county ? `${county.name}, ${county.state}` : `County ${geoid}`;
}

function entryLabel(entry: CoverageEntry, index: BoundaryIndex): string {
  if (entry.level === 'state') {
    return `Statewide (${index.states.get(entry.geoid)?.state ?? entry.geoid})`;
  }
  if (entry.level === 'zip') {
    return `ZIP ${entry.geoid} (${entryCounties(entry).map((c) => countyName(c, index)).join('; ')})`;
  }
  return countyName(entry.geoid, index);
}

/** Tracts grouped by county, e.g. "3 tracts in Knox County, TN", in county order. */
function tractLabels(tracts: CoverageEntry[], index: BoundaryIndex): string[] {
  const byCounty = new Map<string, number>();
  for (const tract of tracts) {
    const county = entryCounties(tract)[0];
    byCounty.set(county, (byCounty.get(county) ?? 0) + 1);
  }
  return [...byCounty.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([county, n]) => `${plural(n, 'tract')} in ${countyName(county, index)}`);
}

/**
 * e.g. "National", "Statewide (TN)", "Knox County, TN", "Knox County, TN; Blount County, TN",
 * "3 tracts in Knox County, TN", "ZIP 37801 (Blount County, TN; Monroe County, TN)".
 * Broadest first; tracts are grouped by county.
 */
export function coverageLabel(coverage: CoverageEntry[], index: BoundaryIndex): string {
  if (coverage.length === 0) return 'Coverage unknown';
  if (isNational(coverage)) return 'National';
  const byLevel = (level: CoverageEntry['level']) =>
    coverage.filter((entry) => entry.level === level).sort((a, b) => a.geoid.localeCompare(b.geoid));
  const all = [
    ...[...byLevel('state'), ...byLevel('county')].map((entry) => entryLabel(entry, index)),
    ...tractLabels(byLevel('tract'), index),
    ...byLevel('zip').map((entry) => entryLabel(entry, index)),
  ];
  const labels = all.slice(0, LABEL_LIMIT);
  const rest = all.length - LABEL_LIMIT;
  return rest > 0 ? `${labels.join('; ')}; +${rest} more` : labels.join('; ');
}

/**
 * How a dataset covers one county, for the map's county panel. Tract and ZIP data
 * covers only part of a county, so the label says how much ("2 tracts in this county",
 * "ZIP 37801, which crosses into other counties"). Otherwise it is the dataset's
 * coverage label.
 */
export function coverageInCounty(coverage: CoverageEntry[], countyGeoid: string, index: BoundaryIndex): string {
  if (coverageRank(coverage, countyGeoid) !== PART_OF_COUNTY) return coverageLabel(coverage, index);
  const here = (level: CoverageEntry['level']) =>
    coverage.filter((entry) => entry.level === level && entryCounties(entry).includes(countyGeoid));
  const tracts = here('tract').length;
  const zips = here('zip');
  const parts: string[] = [];
  if (tracts > 0) parts.push(`${plural(tracts, 'tract')} in this county`);
  if (zips.length === 1) {
    const crosses = entryCounties(zips[0]).length > 1;
    parts.push(`ZIP ${zips[0].geoid}${crosses ? ', which crosses into other counties' : ''}`);
  } else if (zips.length > 1) {
    parts.push(`${plural(zips.length, 'ZIP code')} in this county`);
  }
  return parts.join('; ');
}

/** Whether a tract or zip entry is well formed and every county it lists is known. */
export function knownSubCounty(entry: CoverageEntry, isCounty: (geoid: string) => boolean): boolean {
  const pattern = entry.level === 'tract' ? /^\d{11}$/ : /^\d{5}$/;
  if (!pattern.test(entry.geoid)) return false;
  const counties = entryCounties(entry);
  if (entry.level === 'tract' && !counties.every((c) => c === entry.geoid.slice(0, 5))) return false;
  return counties.length > 0 && counties.every(isCounty);
}

/**
 * Coverage codes that are not in the boundary data (the build fails on any). A tract or
 * zip entry is unknown when its code has the wrong length, it lists no county, or a
 * county it lists is not in the boundary data.
 */
export function unknownCoverageFips(datasets: CoverageDataset[], index: BoundaryIndex): UnknownCoverage[] {
  const unknown: UnknownCoverage[] = [];
  for (const dataset of datasets) {
    for (const entry of dataset.coverage) {
      const known =
        entry.level === 'nation'
          ? entry.geoid === 'US'
          : entry.level === 'state'
            ? index.states.has(entry.geoid)
            : entry.level === 'county'
              ? index.counties.has(entry.geoid)
              : knownSubCounty(entry, (geoid) => index.counties.has(geoid));
      if (!known) unknown.push({ datasetId: dataset.id, level: entry.level, geoid: entry.geoid });
    }
  }
  return unknown;
}

export interface CountClass {
  min: number;
  max: number;
  /** Index into the color ramp, 0 = lightest. */
  step: number;
}

/**
 * Legend classes for the count view. Zero gets no class (no fill). With no more
 * distinct counts than ramp steps, each count is its own class, spread across
 * the ramp; otherwise counts are split into `steps` equal integer ranges.
 */
export function countClasses(counts: Iterable<number>, steps: number): CountClass[] {
  const values = [...new Set([...counts].filter((n) => n > 0))].sort((a, b) => a - b);
  if (values.length === 0) return [];
  if (values.length <= steps) {
    const spread = (i: number) =>
      values.length === 1 ? Math.floor((steps - 1) / 2) : Math.round((i * (steps - 1)) / (values.length - 1));
    return values.map((n, i) => ({ min: n, max: n, step: spread(i) }));
  }
  const min = values[0];
  const max = values[values.length - 1];
  const width = (max - min + 1) / steps;
  return Array.from({ length: steps }, (_, i) => ({
    min: Math.ceil(min + i * width),
    max: i === steps - 1 ? max : Math.ceil(min + (i + 1) * width) - 1,
    step: i,
  })).filter((c) => c.min <= c.max);
}

export function classForCount(count: number, classes: CountClass[]): CountClass | null {
  return classes.find((c) => count >= c.min && count <= c.max) ?? null;
}

/** Datasets with no coverage: not painted on the map, listed in a "not mapped" note. */
export function unmappedDatasets<T extends CoverageDataset>(datasets: T[]): T[] {
  return datasets.filter((dataset) => dataset.coverage.length === 0);
}
