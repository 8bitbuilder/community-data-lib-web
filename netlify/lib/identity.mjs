/**
 * Verify a Netlify Identity login from the request's `Authorization: Bearer <jwt>`.
 *
 * Rather than checking the JWT signature ourselves, ask the site's own Identity
 * (GoTrue) service who the token belongs to: GET /.netlify/identity/user only
 * succeeds for a valid, unexpired token. Only confirmed emails count.
 */

import { normalizeEmail } from '../../src/lib/community/librarianRules.mjs';

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {string} [options.identityUrl] Identity base URL; defaults to `<request origin>/.netlify/identity`.
 * @returns {(request: Request) => Promise<{ email: string } | null>}
 */
export function createIdentityVerifier({ fetch = globalThis.fetch, identityUrl } = {}) {
  return async function verifyUser(request) {
    const match = (request.headers.get('authorization') ?? '').match(/^Bearer\s+(\S+)$/i);
    if (!match) return null;

    const base = (identityUrl ?? `${new URL(request.url).origin}/.netlify/identity`).replace(/\/$/, '');
    let response;
    try {
      response = await fetch(`${base}/user`, { headers: { Authorization: `Bearer ${match[1]}` } });
    } catch {
      return null;
    }
    if (!response.ok) return null;

    const user = await response.json().catch(() => null);
    const email = normalizeEmail(user?.email);
    if (!email || !user.confirmed_at) return null;
    return { email };
  };
}
