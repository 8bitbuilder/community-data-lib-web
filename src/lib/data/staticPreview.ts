/**
 * Logic for the static Data Preview page: which preview files to load, which rows
 * to show (the sample or one county's slice), and how to chart them.
 *
 * The files are Tier 1 previews written by the backend's
 * pythonscripts/export_previews.py and copied to public/previews/ at build time:
 *   <id>/manifest.json, variables.json, sample.json, summary.json, county/<FIPS>.json
 * Rows are arrays of strings in variables.json column order.
 *
 * No DOM or fetch here, so it runs under node:test.
 */

import { AUDIENCE_LABELS, normalizeAudience } from './communityFilter.ts';

export interface PreviewIndexEntry {
  status: 'ok' | 'none';
  reason?: string;
  rows?: number;
  counties?: number;
  tier2?: boolean;
}

export interface PreviewManifest {
  id: string;
  rows: number;
  columns: number;
  sample_rows: number;
  format: string;
  county: {
    method: string;
    columns: string[];
    counties: string[];
    truncated: string[];
  } | null;
  tier2: boolean;
}

export type VariableType = 'number' | 'text' | 'empty';

export interface PreviewVariable {
  name: string;
  code?: string;
  type: VariableType;
}

export interface RowFile {
  rows: string[][];
  rows_included: number;
  rows_total: number;
  truncated?: boolean;
  fips?: string;
}

export interface CommunityCounty {
  name: string;
  county_fips: string;
  /** e.g. "Knox County, TN" */
  label: string;
}

/** URL of one preview file under the site's /previews/ folder. */
export function previewFileUrl(base: string, sourceId: string, file: string): string {
  const parts = [sourceId, ...file.split('/')].map(encodeURIComponent);
  return `${base.replace(/\/+$/, '')}/${parts.join('/')}`;
}

export function countyFileUrl(base: string, sourceId: string, fips: string): string {
  return previewFileUrl(base, sourceId, `county/${fips}.json`);
}

/** The county a `?community=<slug>` link points at, or null for an unknown slug. */
export function communityCounty(
  slug: string | null | undefined,
  communities: Record<string, CommunityCounty>
): CommunityCounty | null {
  if (!slug) return null;
  return Object.prototype.hasOwnProperty.call(communities, slug) ? communities[slug] : null;
}

export type SliceChoice =
  | { kind: 'county'; fips: string; note: string }
  | { kind: 'sample'; note: string | null };

/**
 * Which rows to show first. With a requested county (from ?community= or the
 * county picker), use its slice when the dataset has one, and explain otherwise.
 */
export function chooseSlice(
  manifest: Pick<PreviewManifest, 'county' | 'rows'>,
  county: { fips: string; label: string } | null
): SliceChoice {
  if (!county) return { kind: 'sample', note: null };
  if (!manifest.county) {
    return {
      kind: 'sample',
      note: `This dataset isn't broken down by county, so it can't be narrowed to ${county.label}. Showing the first rows instead.`,
    };
  }
  if (!manifest.county.counties.includes(county.fips)) {
    return {
      kind: 'sample',
      note: `This dataset has no rows for ${county.label}. Showing the first rows instead.`,
    };
  }
  return { kind: 'county', fips: county.fips, note: `Showing the rows for ${county.label}.` };
}

/** "Showing 100 of 244 rows (337 in the full dataset)" style summary for the table. */
export function rowsMeta(file: RowFile, shown: number, scope: string): string {
  const parts = [`Showing ${shown.toLocaleString('en-US')} of ${file.rows_included.toLocaleString('en-US')} rows`];
  if (file.rows_included < file.rows_total) {
    parts.push(`(${file.rows_total.toLocaleString('en-US')} in ${scope}; the preview file holds the first ${file.rows_included.toLocaleString('en-US')})`);
  } else {
    parts.push(`in ${scope}`);
  }
  return parts.join(' ');
}

export function parseNumber(value: unknown): number | null {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (text === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const PREFERRED_FOCAL = /estimate|total|value|amount|production|population|raw value/i;
const TEMPORAL = /^(year|date|period|timeperiod_name|1\. year)$/i;

export function numericVariables(variables: PreviewVariable[]): string[] {
  return variables.filter((v) => v.type === 'number').map((v) => v.name);
}

/** Y axis default: a numeric column that looks like a measure, else the first numeric one. */
export function pickFocalVariable(variables: PreviewVariable[]): string {
  const numeric = numericVariables(variables);
  return numeric.find((name) => PREFERRED_FOCAL.test(name)) ?? numeric[0] ?? '';
}

/** X axis options: label/time columns first, then numeric ones; scatter needs numeric. */
export function xVariableOptions(variables: PreviewVariable[], plotType: string): string[] {
  const text = variables.filter((v) => v.type === 'text').map((v) => v.name);
  const numeric = numericVariables(variables);
  return plotType === 'scatter' ? numeric : [...text, ...numeric];
}

export function defaultXVariable(variables: PreviewVariable[], plotType: string): string {
  const options = xVariableOptions(variables, plotType);
  return options.find((name) => TEMPORAL.test(name)) ?? options[0] ?? '';
}

export interface BarPoint {
  label: string;
  value: number;
}

/**
 * Bar and line charts: mean of Y for each X value, in first-seen order
 * (numeric X values sorted ascending), at most `limit` groups.
 */
export function meanByGroup(rows: string[][], xIndex: number, yIndex: number, limit = 15): BarPoint[] {
  const groups = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    const y = parseNumber(row[yIndex]);
    const x = String(row[xIndex] ?? '').trim();
    if (y === null || x === '') continue;
    const group = groups.get(x) ?? { sum: 0, count: 0 };
    group.sum += y;
    group.count += 1;
    groups.set(x, group);
  }
  let entries = [...groups.entries()];
  if (entries.every(([label]) => parseNumber(label) !== null)) {
    entries = entries.sort((a, b) => (parseNumber(a[0]) ?? 0) - (parseNumber(b[0]) ?? 0));
  }
  return entries.slice(0, limit).map(([label, { sum, count }]) => ({ label, value: sum / count }));
}

export function scatterPoints(rows: string[][], xIndex: number, yIndex: number, limit = 300): [number, number][] {
  const points: [number, number][] = [];
  for (const row of rows) {
    const x = parseNumber(row[xIndex]);
    const y = parseNumber(row[yIndex]);
    if (x !== null && y !== null) points.push([x, y]);
    if (points.length >= limit) break;
  }
  return points;
}

/**
 * Columns to draw in the table: very wide files (County Health Rankings has ~800)
 * show the first `max` columns plus whichever columns the chart uses.
 */
export function tableColumns(total: number, pinned: number[], max = 40): number[] {
  if (total <= max) return Array.from({ length: total }, (_, i) => i);
  const picked = new Set(Array.from({ length: max }, (_, i) => i));
  for (const index of pinned) if (index >= 0 && index < total) picked.add(index);
  return [...picked].sort((a, b) => a - b);
}

/** "Opened from the Teacher catalog view." for ?audience=teacher (read in the browser). */
export function audienceNote(search: string): string | null {
  const audience = normalizeAudience(new URLSearchParams(search).get('audience'));
  return audience ? `Opened from the ${AUDIENCE_LABELS[audience]} catalog view.` : null;
}
