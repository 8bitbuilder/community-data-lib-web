import { loadConfig } from './_lib/config.mjs';
import { json } from './_lib/http.mjs';
import { isAllowed, isValidEmail, normalizeEmail } from './_lib/allowlist.mjs';
import { newNonce, signToken } from './_lib/tokens.mjs';
import { getAuthStore, hitRateLimit } from './_lib/authStore.mjs';
import { sendMagicLink } from './_lib/mailer.mjs';

const MINUTE = 60_000;
const LINK_TTL_MS = 15 * MINUTE;
const RESPONSE = { message: 'If that email is approved, a sign-in link is on its way.' };

export function createHandler({ config, store, sendMail, now = Date.now }) {
  return async (request, context) => {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
    if (request.headers.get('origin') !== config.siteOrigin) return json(403, { error: 'Bad origin' });
    let body;
    try {
      body = await request.json();
    } catch {
      return json(400, { error: 'Invalid JSON' });
    }
    const email = normalizeEmail(body?.email);
    if (!isValidEmail(email)) return json(400, { error: 'Enter a valid email address', field: 'email' });

    const ipLimited = await hitRateLimit(store, `ip/${context?.ip ?? 'unknown'}`, { limit: 20, windowMs: 60 * MINUTE }, now());
    const emailLimited = await hitRateLimit(store, `email/${email}`, { limit: 3, windowMs: 15 * MINUTE }, now());
    if (ipLimited || emailLimited) {
      console.warn('auth-request-link: rate limited');
      return json(200, RESPONSE);
    }
    if (!isAllowed(email, config.editorEmails)) return json(200, RESPONSE);

    const token = signToken({ email, exp: now() + LINK_TTL_MS, nonce: newNonce(), purpose: 'link' }, config.authSecret);
    const link = `${config.siteOrigin}/.netlify/functions/auth-verify?token=${encodeURIComponent(token)}`;
    const delivery = sendMail({ to: email, link }).catch((err) => console.error('auth-request-link: email failed:', err.message));
    if (typeof context?.waitUntil === 'function') context.waitUntil(delivery);
    return json(200, RESPONSE);
  };
}

export default async (request, context) => {
  const config = loadConfig();
  const sendMail = ({ to, link }) => sendMagicLink({ apiKey: config.resendApiKey, from: config.mailFrom, to, link });
  return createHandler({ config, store: await getAuthStore(), sendMail })(request, context);
};
