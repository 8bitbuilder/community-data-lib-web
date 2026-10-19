import { signToken, verifyToken } from './tokens.mjs';
import { isAllowed } from './allowlist.mjs';
import { HttpError } from './http.mjs';

export const SESSION_COOKIE = 'cdl_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ATTRS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export function sessionCookie(email, secret, now = Date.now()) {
  const token = signToken({ email, exp: now + SESSION_TTL_SECONDS * 1000, purpose: 'session' }, secret);
  return `${SESSION_COOKIE}=${token}; ${ATTRS}; Max-Age=${SESSION_TTL_SECONDS}`;
}

export const clearSessionCookie = () => `${SESSION_COOKIE}=; ${ATTRS}; Max-Age=0`;

export function readCookie(request, name) {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=');
    if (index !== -1 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function checkOrigin(request, config) {
  if (request.headers.get('origin') !== config.siteOrigin) throw new HttpError(403, 'Bad origin');
}

export function requireEditor(request, config, now = Date.now()) {
  const result = verifyToken(readCookie(request, SESSION_COOKIE), config.authSecret, { purpose: 'session', now });
  if (!result.payload) throw new HttpError(401, 'Not signed in');
  if (!isAllowed(result.payload.email, config.editorEmails)) throw new HttpError(403, 'Access removed');
  if (request.method !== 'GET' && request.method !== 'HEAD') checkOrigin(request, config);
  return result.payload.email;
}
