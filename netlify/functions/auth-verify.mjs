import { loadConfig } from './_lib/config.mjs';
import { isAllowed } from './_lib/allowlist.mjs';
import { verifyToken } from './_lib/tokens.mjs';
import { sessionCookie } from './_lib/session.mjs';
import { consumeNonce, getAuthStore } from './_lib/authStore.mjs';

const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// GET never consumes the link: email security scanners pre-fetch links.
// Only the POST from this page's button signs the person in.
const confirmPage = (token) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}button{font-size:1rem;padding:.75rem 1.5rem;cursor:pointer}</style>
</head><body><form method="post" action="/.netlify/functions/auth-verify">
<input type="hidden" name="token" value="${escapeHtml(token)}">
<p>Sign in to edit Community Data Libraries metadata.</p>
<button type="submit">Sign in</button>
</form></body></html>`;

export function createHandler({ config, store, now = Date.now }) {
  const redirect = (reason, cookie) =>
    new Response(null, {
      status: 303,
      headers: { location: `${config.siteOrigin}${config.previewPath}?auth=${reason}`, ...(cookie ? { 'set-cookie': cookie } : {}) },
    });

  return async (request) => {
    if (request.method === 'GET') {
      const token = new URL(request.url).searchParams.get('token');
      const result = verifyToken(token, config.authSecret, { purpose: 'link', now: now() });
      if (!result.payload) return redirect(result.error);
      return new Response(confirmPage(token), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
          'x-frame-options': 'DENY',
          'content-security-policy': "frame-ancestors 'none'",
        },
      });
    }
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const origin = request.headers.get('origin');
    if (origin && origin !== config.siteOrigin) return redirect('invalid');

    const token = (await request.formData().catch(() => null))?.get('token');
    const result = verifyToken(typeof token === 'string' ? token : null, config.authSecret, { purpose: 'link', now: now() });
    if (!result.payload) return redirect(result.error);
    const { email, nonce, exp } = result.payload;
    if (typeof nonce !== 'string' || !(await consumeNonce(store, nonce, exp))) return redirect('expired');
    if (!isAllowed(email, config.editorEmails)) return redirect('invalid');
    console.log(`auth-verify: signed in ${email}`);
    return redirect('ok', sessionCookie(email, config.authSecret, now()));
  };
}

export default async (request, context) =>
  createHandler({ config: loadConfig(), store: await getAuthStore() })(request, context);
