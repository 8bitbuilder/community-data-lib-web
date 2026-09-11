function resolveApiBase(): string {
  const configured = import.meta.env.PUBLIC_API_BASE_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');
  // In dev, Astro proxies /api/sources and /api/health to the preview API (see astro.config.mjs).
  if (import.meta.env.DEV) return '';
  return 'http://localhost:4323';
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

export interface PreviewParams {
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

async function apiFetch<T>(path: string): Promise<T> {
  try {
    const response = await fetch(`${API_BASE}${path}`, {
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('text/html')) {
        throw new Error(
          `API error ${response.status}: preview API not reachable. Run \`npm run backend:dev\` (port 4323) in the web repo, then reload.`,
        );
      }
      const body = await response.json().catch(() => ({}));
      throw new Error((body as { details?: string; error?: string }).details ?? (body as { error?: string }).error ?? `API error ${response.status}`);
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
  } = {},
): Promise<ChartResponse> {
  const search = new URLSearchParams();
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
): Promise<FilterOption[]> {
  const search = new URLSearchParams({ type });
  if (state) search.set('state', state);
  const data = await apiFetch<{ options: FilterOption[] }>(
    `/api/sources/${encodeURIComponent(id)}/filters?${search}`,
  );
  return data.options;
}

export function normalizeDescriptionTags(tags: BackendSource['description_tags']): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags;
  return Object.entries(tags)
    .filter(([, active]) => active)
    .map(([tag]) => tag);
}

export function getPedagogicalTags(source: BackendSource, limit = 8): string[] {
  const tags: string[] = [];
  for (const [key, value] of Object.entries(source)) {
    if (!key.endsWith('_tags') || key === 'description_tags') continue;
    if (typeof value !== 'object' || value === null) continue;
    for (const [tagName, active] of Object.entries(value as Record<string, boolean>)) {
      if (active) tags.push(tagName.replace(/-/g, ' '));
    }
  }
  return tags.slice(0, limit);
}

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
