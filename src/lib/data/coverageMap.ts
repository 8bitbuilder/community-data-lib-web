/**
 * Pure coverage logic for the /maps page.
 *
 * Coverage is defined by FIPS codes only (see backend source_coverage): a
 * dataset covers the nation, whole states, or single counties. Boundary
 * geometry is for display; nothing here intersects shapes.
 *
 * Expansion rules:
 *   nation -> every county in the boundary data
 *   state  -> every county whose GEOID starts with that state FIPS
 *   county -> that county
 * A dataset with no coverage is "coverage unknown": it is not counted and is
 * listed separately.
 *
 * No Astro or Vite imports, so it runs in the browser bundle and under Node's
 * test runner (see tests/coverageMap.test.ts).
 */

import type { CoverageEntry } from './communityFilter.ts';

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
const LEVEL_RANK: Record<CoverageEntry['level'], number> = { county: 0, state: 1, nation: 2 };

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

/** County GEOIDs a coverage list describes. FIPS codes missing from the index are ignored. */
export function expandCoverage(coverage: CoverageEntry[], index: BoundaryIndex): Set<string> {
  const result = new Set<string>();
  for (const entry of coverage) {
    if (entry.level === 'nation') {
      for (const geoid of index.counties.keys()) result.add(geoid);
    } else if (entry.level === 'state') {
      for (const geoid of index.countiesByState.get(entry.geoid) ?? []) result.add(geoid);
    } else if (index.counties.has(entry.geoid)) {
      result.add(entry.geoid);
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

/** How locally a dataset covers a county (0 county, 1 state, 2 nation), or null if it doesn't. */
function coverageRank(coverage: CoverageEntry[], countyGeoid: string): number | null {
  let best: number | null = null;
  for (const entry of coverage) {
    const covers =
      entry.level === 'nation' ||
      (entry.level === 'state' && countyGeoid.startsWith(entry.geoid)) ||
      (entry.level === 'county' && entry.geoid === countyGeoid);
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

function entryLabel(entry: CoverageEntry, index: BoundaryIndex): string {
  if (entry.level === 'state') {
    return `Statewide (${index.states.get(entry.geoid)?.state ?? entry.geoid})`;
  }
  const county = index.counties.get(entry.geoid);
  return county ? `${county.name}, ${county.state}` : `County ${entry.geoid}`;
}

/** e.g. "National", "Statewide (TN)", "Knox County, TN", "Knox County, TN; Blount County, TN". */
export function coverageLabel(coverage: CoverageEntry[], index: BoundaryIndex): string {
  if (coverage.length === 0) return 'Coverage unknown';
  if (isNational(coverage)) return 'National';
  const sorted = [...coverage].sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.geoid.localeCompare(b.geoid));
  const labels = sorted.slice(0, LABEL_LIMIT).map((entry) => entryLabel(entry, index));
  const rest = sorted.length - LABEL_LIMIT;
  return rest > 0 ? `${labels.join('; ')}; +${rest} more` : labels.join('; ');
}

/** Coverage FIPS codes that are not in the boundary data (the build fails on any). */
export function unknownCoverageFips(datasets: CoverageDataset[], index: BoundaryIndex): UnknownCoverage[] {
  const unknown: UnknownCoverage[] = [];
  for (const dataset of datasets) {
    for (const entry of dataset.coverage) {
      const known =
        entry.level === 'nation'
          ? entry.geoid === 'US'
          : entry.level === 'state'
            ? index.states.has(entry.geoid)
            : index.counties.has(entry.geoid);
      if (!known) unknown.push({ datasetId: dataset.id, level: entry.level, geoid: entry.geoid });
    }
  }
  return unknown;
}

/** Datasets with no coverage: not painted on the map, listed in a "not mapped" note. */
export function unmappedDatasets<T extends CoverageDataset>(datasets: T[]): T[] {
  return datasets.filter((dataset) => dataset.coverage.length === 0);
}
