import { loadConfig } from './_lib/config.mjs';
import { json, toResponse } from './_lib/http.mjs';
import { requireEditor } from './_lib/session.mjs';

export function createHandler({ config, now = Date.now }) {
  return async (request) => {
    try {
      return json(200, { email: requireEditor(request, config, now()) });
    } catch (err) {
      return toResponse(err);
    }
  };
}

export default async (request, context) => createHandler({ config: loadConfig() })(request, context);
