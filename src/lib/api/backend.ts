function resolveApiBase(): string {
  const configured = import.meta.env?.PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  // Same origin: in dev, Astro proxies /api/* to backend/server.mjs (see astro.config.mjs);
  // on Netlify, /api/* is served by netlify/functions/preview-api.mjs.
  return '';
}

const API_BASE = resolveApiBase();

export interface SourceProvider {
  name?: string;
  agency?: string;
  url?: string;
}

export interface SourceDownload {
  url?: string;
  description?: string;
  file_size?: string;
  sheet?: string | number;
  header_row?: number;
}

export interface SourceFilters {
  year?: boolean;
  state?: boolean;
  county?: boolean;
  zipcode?: boolean;
}

export interface VariableReport {
  name: string;
  type?: string;
  total_rows?: number;
  non_empty_count?: number;
  missing_count?: number;
  missing_pct?: number;
  unique_count?: number;
  min?: number;
  max?: number;
  mean?: number;
  sample_values?: string[];
}

export interface BackendSource {
  id: string;
  title: string;
  notes?: string;
  provider?: SourceProvider;
  download?: SourceDownload;
  requires_account?: boolean;
  sensitive?: boolean;
  filters?: SourceFilters;
  variables?: string[];
  variable_report?: VariableReport[];
  description_tags?: string[] | Record<string, boolean>;
  [key: string]: unknown;
}

export interface Datasheet {
  who: string;
  how: string;
  where: string;
  why: string;
  when: string;
}

/**
 * A sheet, always as its 0-based position in the workbook. The `sheet` query and
 * page-URL parameter is an index, never a name, so sheets named like numbers
 * ("2024", "1") can't be confused with positions.
 */
export type SheetParam = number;

/** The `sheet` URL/query value -> 0-based index; anything but whole digits is ignored. */
export function parseSheetParam(value: string | null | undefined): SheetParam | undefined {
  return value != null && /^\d+$/.test(value) ? Number(value) : undefined;
}

export interface ExcelLayout {
  format: 'xlsx' | 'xls';
  sheets: string[];
  sheet: string;
  headerRow: number;
  dataRowCount: number;
  trimmedRows: number;
  origin: {
    sheet: 'visitor' | 'curator' | 'auto';
    headerRow: 'visitor' | 'curator' | 'auto';
  };
}

export interface PreviewParams {
  sheet?: SheetParam;
  headerRow?: number;
  state?: string;
  county?: string;
  limit?: number;
  offset?: number;
  columns?: string;
}

export interface PreviewResponse {
  id: string;
  columns: string[];
  rows: string[][];
  total: number;
  filters: { state: string | null; county: string | null };
  availableFilters: SourceFilters;
  layout?: ExcelLayout;
}

export interface ChartSeriesPoint {
  label: string;
  value: number;
}

export interface ChartScatterPoint {
  x: number;
  y: number;
}

export type PlotType = 'bar' | 'line' | 'scatter';

export interface ChartResponse {
  variable: string;
  label: string;
  series?: ChartSeriesPoint[];
  points?: ChartScatterPoint[];
  xVariable?: string;
  xLabel?: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

const API_TIMEOUT_MS = 60_000;

export class ApiError extends Error {
  status: number;
  body: Record<string, unknown>;
  constructor(message: string, status: number, body: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function setLayoutParams(search: URLSearchParams, params: { sheet?: SheetParam; headerRow?: number }) {
  if (params.sheet != null) search.set('sheet', String(params.sheet));
  if (params.headerRow != null) search.set('header_row', String(params.headerRow));
}

async function apiFetch<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        throw new Error(
          import.meta.env?.DEV
            ? `API error ${response.status}: preview API not reachable. Run \`npm run backend:dev\` (port 4323) in the web repo, then reload.`
            : `API error ${response.status}: the preview service is unavailable. Please try again later.`,
        );
      }
      const body = (await response.json().catch(() => ({}))) as {
        details?: string;
        error?: string;
        [key: string]: unknown;
      };
      // e.g. "This dataset can't be previewed yet (XLSX files are not supported…)"
      const message =
        body.error && body.details ? `${body.error} (${body.details})` : body.details ?? body.error;
      throw new ApiError(message ?? `API error ${response.status}`, response.status, body);
    }
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(
        `Request timed out after ${API_TIMEOUT_MS / 1000}s. The preview API may be busy loading data — try again in a moment.`,
      );
    }
    throw error;
  }
}

export function getApiBaseUrl(): string {
  return API_BASE;
}

export async function fetchSources(): Promise<BackendSource[]> {
  const data = await apiFetch<{ data: BackendSource[] }>('/api/sources');
  return data.data;
}

export async function fetchSource(id: string): Promise<BackendSource> {
  return apiFetch<BackendSource>(`/api/sources/${encodeURIComponent(id)}`);
}

export async function fetchDatasheet(id: string): Promise<Datasheet> {
  const data = await apiFetch<{ datasheet: Datasheet }>(
    `/api/sources/${encodeURIComponent(id)}/datasheet`,
  );
  return data.datasheet;
}

export async function fetchPreview(id: string, params: PreviewParams = {}): Promise<PreviewResponse> {
  const search = new URLSearchParams();
  setLayoutParams(search, params);
  if (params.state) search.set('state', params.state);
  if (params.county) search.set('county', params.county);
  if (params.limit != null) search.set('limit', String(params.limit));
  if (params.offset != null) search.set('offset', String(params.offset));
  if (params.columns) search.set('columns', params.columns);
  const qs = search.toString();
  return apiFetch<PreviewResponse>(
    `/api/sources/${encodeURIComponent(id)}/preview${qs ? `?${qs}` : ''}`,
  );
}

export async function fetchChart(
  id: string,
  params: {
    variable?: string;
    xVariable?: string;
    plotType?: PlotType;
    state?: string;
    county?: string;
    limit?: number;
    sheet?: SheetParam;
    headerRow?: number;
  } = {},
): Promise<ChartResponse> {
  const search = new URLSearchParams();
  setLayoutParams(search, params);
  if (params.variable) search.set('variable', params.variable);
  if (params.xVariable) search.set('xVariable', params.xVariable);
  if (params.plotType) search.set('plotType', params.plotType);
  if (params.state) search.set('state', params.state);
  if (params.county) search.set('county', params.county);
  if (params.limit != null) search.set('limit', String(params.limit));
  const qs = search.toString();
  return apiFetch<ChartResponse>(
    `/api/sources/${encodeURIComponent(id)}/chart${qs ? `?${qs}` : ''}`,
  );
}

export async function fetchFilterOptions(
  id: string,
  type: 'state' | 'county',
  state?: string,
  layout: { sheet?: SheetParam; headerRow?: number } = {},
): Promise<FilterOption[]> {
  const search = new URLSearchParams({ type });
  setLayoutParams(search, layout);
  if (state) search.set('state', state);
  const data = await apiFetch<{ options: FilterOption[] }>(
    `/api/sources/${encodeURIComponent(id)}/filters?${search}`,
  );
  return data.options;
}

export interface SourceFileResult {
  bytes: Uint8Array;
  filename: string;
  format: 'csv' | 'tsv' | 'xlsx' | 'xls';
  archive: 'zip' | null;
  /** Zipped sources: the file's full path inside the zip (e.g. "data/sub/file.csv"). */
  archiveEntry: string | null;
}

/** Downloads the source's raw file through the API (used by the notebook). */
export async function fetchSourceFile(id: string): Promise<SourceFileResult> {
  const path = `/api/sources/${encodeURIComponent(id)}/file`;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { signal: AbortSignal.timeout(API_TIMEOUT_MS) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s while downloading the file.`);
    }
    throw error;
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const message = typeof body.error === 'string' ? body.error : `API error ${response.status}`;
    throw new ApiError(message, response.status, body);
  }
  const decodeHeader = (raw: string) => {
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  };
  const archive = response.headers.get('X-CDL-Archive') === 'zip' ? 'zip' : null;
  const entry = response.headers.get('X-CDL-Archive-Entry');
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    filename: decodeHeader(response.headers.get('X-CDL-Filename') ?? ''),
    format: (response.headers.get('X-CDL-Format') ?? 'csv') as SourceFileResult['format'],
    archive,
    archiveEntry: archive && entry ? decodeHeader(entry) : null,
  };
}

export function normalizeDescriptionTags(tags: BackendSource['description_tags']): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  return Object.entries(tags)
    .filter(([, active]) => active)
    .map(([tag]) => tag);
}

export { getPedagogicalTags } from './tags.ts';

export function buildCatalogDescription(source: BackendSource): string {
  const provider = source.provider?.name ?? 'a government data provider';
  const agency = source.provider?.agency;
  const themes = normalizeDescriptionTags(source.description_tags);

  const intro = agency
    ? `${source.title} from ${provider} (${agency}).`
    : `${source.title} from ${provider}.`;

  const themeSentence =
    themes.length > 0
      ? ` Topics include ${themes.slice(0, 5).join(', ')}${themes.length > 5 ? ', and more' : ''}.`
      : '';

  const accessNote = source.requires_account
    ? ' A free provider account is required to download the full dataset.'
    : source.download?.url
      ? ' Data is available for direct download.'
      : source.download?.description
        ? ` ${source.download.description}`
        : '';

  const detail = source.notes
    ? ` ${source.notes.length > 200 ? `${source.notes.slice(0, 197)}...` : source.notes}`
    : '';

  return (intro + themeSentence + accessNote + detail).replace(/\s+/g, ' ').trim();
}

export function getGeographicTags(source: BackendSource): string[] {
  const filters = source.filters ?? {};
  const tags: string[] = [];
  if (filters.state) tags.push('state');
  if (filters.county) tags.push('county');
  if (filters.zipcode) tags.push('zipcode');
  if (filters.year) tags.push('year');

  const variables = (source.variables ?? []).map((v) => v.toUpperCase());
  if (variables.some((v) => v.includes('COUNTY') || v === 'CTYNAME') && !tags.includes('county')) {
    tags.push('county');
  }
  if (variables.some((v) => v === 'STATE' || v === 'STNAME') && !tags.includes('state')) {
    tags.push('state');
  }
  return tags;
}

const GRANULARITY_LABELS: Record<string, string> = {
  nation: 'national',
  state: 'state',
  county: 'county',
  tract: 'census tract',
  zip: 'zip code',
  zipcode: 'zip code',
  point: 'point location',
};

/**
 * Geographic tags for display. Unlike getGeographicTags (which only reports levels
 * the data can be filtered by), this leads with the source's `geographic_granularity`,
 * so sources with no filters or variable list (e.g. national datasets) still show one.
 */
export function getGeographicDisplayTags(source: BackendSource): string[] {
  const granularity = String(source.geographic_granularity ?? '').toLowerCase();
  const tags = [
    GRANULARITY_LABELS[granularity] ?? granularity,
    ...getGeographicTags(source)
      .filter((tag) => tag !== 'year')
      .map((tag) => GRANULARITY_LABELS[tag] ?? tag),
  ].filter(Boolean);
  return [...new Set(tags)];
}
