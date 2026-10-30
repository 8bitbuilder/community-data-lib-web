/**
 * Local preview API server (development only; routes in backend/lib/apiHandler.mjs).
 * The deployed site has no preview server: /data-preview reads the static Tier 1
 * preview files the backend exports (copied to public/previews/ at build time).
 *
 * Locally this reads sources from SQLite (or YAML if no database exists) and uses
 * pandas when available, falling back to the Node engine.
 */

import http from 'node:http';
import { createApiHandler, nodeEngine } from './lib/apiHandler.mjs';
import {
  buildChartWithPandas,
  buildPreviewWithPandas,
  isPandasPreviewAvailable,
  listFilterOptionsWithPandas,
} from './lib/pandasPreview.mjs';
import { getDataSource, loadAllSources, loadSourceById } from './lib/sourceStore.mjs';

const port = Number(process.env.BACKEND_PORT ?? 4323);
const usePandas = process.env.PREVIEW_ENGINE !== 'node' && isPandasPreviewAvailable();

const pandasEngine = {
  name: 'pandas',
  buildPreview: buildPreviewWithPandas,
  buildChart: buildChartWithPandas,
  listFilterOptions: listFilterOptionsWithPandas,
};

const handle = createApiHandler({
  loadAllSources,
  loadSourceById,
  engine: usePandas ? pandasEngine : nodeEngine,
  health: () => ({ port, dataSource: getDataSource() }),
});

const server = http.createServer(async (req, res) => {
  const request = new Request(
    new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`),
    {
      method: req.method ?? 'GET',
    }
  );
  const response = await handle(request);
  const body = Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, {
    ...Object.fromEntries(response.headers),
    'Content-Length': body.length,
  });
  res.end(body);
});

server.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
