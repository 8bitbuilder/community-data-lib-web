/**
 * Preview API routing for the local dev server (backend/server.mjs). Development
 * only: the deployed site reads static preview files (public/previews/) and never
 * reads or filters datasets at request time.
 *
 * Uses the standard Fetch API Request/Response, adapted to Node's http server.
 *
 * Routes:
 *   GET /api/health
 *   GET /api/sources
 *   GET /api/sources/:id
 *   GET /api/sources/:id/datasheet
 *   GET /api/sources/:id/preview?state&county&limit&offset&columns&sheet&header_row
 *   GET /api/sources/:id/chart?variable&xVariable&plotType&state&county&limit&sheet&header_row
 *   GET /api/sources/:id/filters?type&state&sheet&header_row
 */

import { buildChart, buildPreview, listFilterOptions } from './dataPreview.mjs';
import { LayoutError } from '../../src/lib/data/excelLayout.mjs';
import { buildDatasheet } from './datasheet.mjs';

/** The JS preview engine; works anywhere Node runs (including Netlify Functions). */
export const nodeEngine = { name: 'node', buildPreview, buildChart, listFilterOptions };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

/** Errors that mean "this dataset can't be previewed", not "the server broke". */
const UNPREVIEWABLE = [
  /has no download URL/i,
  /no CSV, TSV or Excel files/i,
];

function json(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

/** `sheet` and `header_row` query params -> table options (digits in sheet = 0-based index). */
function tableParams(q) {
  const out = {};
  const sheet = q.get('sheet');
  if (sheet !== null && sheet !== '') out.sheet = /^\d+$/.test(sheet) ? Number(sheet) : sheet;
  const row = q.get('header_row');
  if (row !== null) {
    if (!/^\d+$/.test(row) || Number(row) < 1) {
      throw new LayoutError('HEADER_OUT_OF_RANGE', 'header_row must be a whole number of 1 or more');
    }
    out.headerRow = Number(row);
  }
  return out;
}

function isExcelSource(source, table) {
  const path = String(source.download?.url ?? '').split('?')[0].toLowerCase();
  return (
    path.endsWith('.xlsx') ||
    path.endsWith('.xls') ||
    table.sheet !== undefined ||
    table.headerRow !== undefined
  );
}

function parseSourcePath(pathname) {
  const prefix = '/api/sources/';
  if (!pathname.startsWith(prefix)) return null;
  const rest = decodeURIComponent(pathname.slice(prefix.length)).replace(/\/+$/, '');
  const slash = rest.indexOf('/');
  if (slash === -1) return { id: rest, action: null };
  return { id: rest.slice(0, slash), action: rest.slice(slash + 1) };
}

/**
 * @param {object} deps
 * @param {() => Promise<object[]>} deps.loadAllSources
 * @param {(id: string) => Promise<object|null>} deps.loadSourceById
 * @param {{name: string, buildPreview: Function, buildChart: Function, listFilterOptions: Function}} [deps.engine]
 *   Preferred engine (e.g. pandas locally). Falls back to the Node engine on error.
 * @param {() => object} [deps.health] Extra fields for /api/health.
 */
export function createApiHandler({
  loadAllSources,
  loadSourceById,
  engine = nodeEngine,
  health = () => ({}),
}) {
  // Run with the preferred engine; on failure retry with the Node engine (same as before).
  async function run(method, args, { excel = false } = {}) {
    if (engine === nodeEngine || excel) return { result: await nodeEngine[method](...args), engine: 'node' };
    try {
      return { result: await engine[method](...args), engine: engine.name };
    } catch (error) {
      return { result: await nodeEngine[method](...args), engine: 'node', fallback: String(error) };
    }
  }

  // Object results (preview, chart) carry engine info inline, as the old server did.
  const withEngine = ({ result, engine: used, fallback }) => ({
    ...result,
    engine: used,
    ...(fallback ? { pandasFallback: fallback } : {}),
  });

  return async function handle(request) {
    const url = new URL(request.url);
    const { pathname, searchParams: q } = url;

    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

    try {
      if (pathname === '/api/health') {
        return json(200, { ok: true, service: 'backend', previewEngine: engine.name, ...health() });
      }

      if (pathname === '/api/sources' || pathname === '/api/sources/') {
        const sources = await loadAllSources();
        return json(200, { count: sources.length, data: sources });
      }

      const parsed = parseSourcePath(pathname);
      if (!parsed?.id) return json(404, { error: 'Not found' });

      const source = await loadSourceById(parsed.id);
      if (!source) return json(404, { error: 'Source not found', id: parsed.id });

      if (!parsed.action) return json(200, source);

      if (parsed.action === 'datasheet') {
        return json(200, { id: parsed.id, datasheet: buildDatasheet(source) });
      }

      if (parsed.action === 'preview') {
        const table = tableParams(q);
        const options = {
          ...table,
          state: q.get('state') ?? undefined,
          county: q.get('county') ?? undefined,
          limit: Number(q.get('limit') ?? 25),
          offset: Number(q.get('offset') ?? 0),
          columns: q.get('columns') ?? undefined,
        };
        return json(200, withEngine(await run('buildPreview', [source, options], {
            excel: isExcelSource(source, table),
          })));
      }

      if (parsed.action === 'chart') {
        const table = tableParams(q);
        const options = {
          ...table,
          variable: q.get('variable') ?? undefined,
          xVariable: q.get('xVariable') ?? undefined,
          plotType: q.get('plotType') ?? undefined,
          state: q.get('state') ?? undefined,
          county: q.get('county') ?? undefined,
          limit: Number(q.get('limit') ?? 50),
        };
        return json(200, withEngine(await run('buildChart', [source, options], {
            excel: isExcelSource(source, table),
          })));
      }

      if (parsed.action === 'filters') {
        const type = q.get('type') ?? 'state';
        const parent = { state: q.get('state') ?? undefined };
        const table = tableParams(q);
        const {
          result,
          engine: used,
          fallback,
        } = await run('listFilterOptions', [source, type, parent, table], {
          excel: isExcelSource(source, table),
        });
        return json(200, {
          id: parsed.id,
          type,
          options: result,
          engine: used,
          ...(fallback ? { pandasFallback: fallback } : {}),
        });
      }

      return json(404, { error: 'Not found', action: parsed.action });
    } catch (error) {
      if (error instanceof LayoutError) {
        if (error.code === 'NO_DATA') {
          return json(422, { error: 'This sheet has no data rows', code: error.code });
        }
        return json(400, { error: error.message, code: error.code, sheets: error.sheets });
      }
      const message = error instanceof Error ? error.message : String(error);
      if (UNPREVIEWABLE.some((re) => re.test(message))) {
        return json(422, { error: "This dataset can't be previewed yet", details: message });
      }
      if (/Download failed|fetch failed|aborted|timed out/i.test(message)) {
        return json(502, { error: "Couldn't load the data from its provider", details: message });
      }
      return json(500, { error: 'Internal server error', details: message });
    }
  };
}
