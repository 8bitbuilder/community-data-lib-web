import { loadConfig } from './_lib/config.mjs';
import { json, toResponse } from './_lib/http.mjs';
import { checkOrigin, clearSessionCookie } from './_lib/session.mjs';

export function createHandler({ config }) {
  return async (request) => {
    try {
      if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
      checkOrigin(request, config);
      return json(200, { ok: true }, { 'set-cookie': clearSessionCookie() });
    } catch (err) {
      return toResponse(err);
    }
  };
}

export default async (request, context) => createHandler({ config: loadConfig() })(request, context);
