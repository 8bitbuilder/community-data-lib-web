/**
 * Serves each community library on its own subdomain (web#31):
 * knox-county.communitydatalibraries.org/ shows /communities/knox-county/.
 *
 * The routing rules are in src/lib/community/libraryHosts.mjs (tested in
 * tests/libraryHosts.test.ts). This file reads the settings, checks the slug against
 * the deploy's libraries (/library-slugs.json, written by the build), and turns a
 * route into a rewrite, a redirect or a 404. With PUBLIC_LIBRARY_DOMAIN unset it
 * does nothing, so deploy previews and branch deploys behave as before.
 *
 * Netlify runs edge functions before the redirect rules in netlify.toml. A returned
 * URL is a same-site rewrite with a 200; the visitor's address bar keeps the subdomain.
 * Setup: docs/technical/netlify.md.
 */
import { routeLibraryRequest } from '../../src/lib/community/libraryHosts.mjs';

// A deploy's files never change, so its slug list is fetched once per deploy and isolate.
const slugCache = new Map();

async function deploySlugs(request, deployId) {
  if (!slugCache.has(deployId)) {
    const pending = fetch(new URL('/library-slugs.json', request.url))
      .then((response) => (response.ok ? response.json() : null))
      .then((slugs) => (Array.isArray(slugs) ? slugs : null))
      .catch(() => null);
    slugCache.set(deployId, pending);
  }
  const slugs = await slugCache.get(deployId);
  if (!slugs) slugCache.delete(deployId); // try again on the next request
  return slugs;
}

// Note: `netlify dev` ignores a 404 from an edge function and serves the static file
// at the original path (the main home page at "/"). Deployed sites return this response.
async function notFound(request) {
  const page = await fetch(new URL('/404.html', request.url)).catch(() => null);
  const body = page?.ok ? await page.text() : 'Not found';
  return new Response(body, { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

export default async (request, context) => {
  const env = globalThis.Netlify?.env;
  const route = routeLibraryRequest(new URL(request.url), {
    libraryDomain: env?.get('PUBLIC_LIBRARY_DOMAIN'),
    mainSiteUrl: env?.get('PUBLIC_MAIN_SITE_URL'),
  });
  if (!route) return undefined;
  if (route.redirect) return Response.redirect(route.redirect, 301);

  // If the list can't be read, rewrite anyway: a missing page still 404s, except at "/".
  const slugs = await deploySlugs(request, context?.deploy?.id ?? 'local');
  if (slugs && !slugs.includes(route.slug)) return notFound(request);
  return new URL(route.rewrite, request.url);
};

export const config = {
  path: '/*',
  // Built assets and functions never need routing; skipping them saves invocations.
  excludedPath: ['/web/_astro/*', '/.netlify/*', '/api/*'],
};
