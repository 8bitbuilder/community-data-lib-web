/**
 * Library subdomains (web#31): `knox-county.communitydatalibraries.org` serves the
 * pages built at `/communities/knox-county/`.
 *
 * Pure functions only, with no imports, so the same code runs in the Astro build,
 * in the browser, in the edge function (netlify/edge-functions/library-host.js, Deno)
 * and in tests.
 *
 * Both settings come from environment variables and are optional:
 * - libraryDomain (PUBLIC_LIBRARY_DOMAIN), e.g. "communitydatalibraries.org". Unset,
 *   libraries stay at /web/communities/<slug>/ and the edge function does nothing.
 * - mainSiteUrl (PUBLIC_MAIN_SITE_URL), e.g. "https://community-data-libraries.netlify.app".
 *   Library pages link to main-site pages with it. Unset, those links stay relative.
 *
 * See docs/technical/library-subdomains.md and docs/technical/netlify.md.
 */

/** Subdomains that can never be library slugs, because the site or email uses them. */
export const RESERVED_SLUGS = Object.freeze([
  'admin', 'api', 'app', 'assets', 'blog', 'cdn', 'cdl', 'dev', 'docs', 'email', 'ftp',
  'help', 'librarian', 'librarians', 'mail', 'main', 'ns1', 'ns2', 'preview', 'smtp',
  'staging', 'static', 'status', 'support', 'test', 'web', 'www',
]);

/** Same as SLUG_PATTERN in librarianRules.mjs; also a valid DNS label (with the 60-character limit). */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SLUG = 60;

export function isReservedSlug(slug) {
  return RESERVED_SLUGS.includes(String(slug ?? '').toLowerCase());
}

/** "https://*.Example.org/" -> "example.org"; empty -> null. */
export function normalizeDomain(value) {
  const domain = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/[/.]+$/, '');
  return domain === '' ? null : domain;
}

/** "https://example.org/web/" -> "https://example.org"; empty or invalid -> null. */
export function normalizeOrigin(value) {
  const text = String(value ?? '').trim();
  if (text === '') return null;
  try {
    return new URL(text).origin;
  } catch {
    return null;
  }
}

function basePrefix(basePath) {
  const base = String(basePath ?? '/');
  return base.endsWith('/') ? base : `${base}/`;
}

function withBase(path, basePath) {
  return `${basePrefix(basePath)}${String(path).replace(/^\/+/, '')}`;
}

/** The slug served by `host`, or null when `host` is not a library subdomain of `domain`. */
export function librarySlugForHost(host, domain) {
  const root = normalizeDomain(domain);
  const name = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!root || !name.endsWith(`.${root}`)) return null;
  const label = name.slice(0, -(root.length + 1));
  if (!SLUG.test(label) || label.length > MAX_SLUG || isReservedSlug(label)) return null;
  return label;
}

/**
 * Public address of a page in a library. `path` is relative to the library's home
 * ("/" or "/catalog/").
 */
export function libraryUrl(slug, path = '/', { libraryDomain, basePath } = {}) {
  const domain = normalizeDomain(libraryDomain);
  const rest = `/${String(path).replace(/^\/+/, '')}`;
  if (domain) return `https://${slug}.${domain}${rest}`;
  return withBase(`/communities/${slug}${rest}`, basePath);
}

/** Address of a main-site page (`path` without the base, e.g. "/submit"). */
export function mainSiteUrl(path = '/', { mainSiteUrl: origin, basePath } = {}) {
  const local = path === '/' ? basePrefix(basePath) : withBase(path, basePath);
  const main = normalizeOrigin(origin);
  return main ? `${main}${local}` : local;
}

function hasExtension(pathname) {
  const last = pathname.split('/').pop() ?? '';
  return last.includes('.');
}

/**
 * What the edge function does with a request:
 * - `{ rewrite, slug }`: serve that same-site path with a 200 (the address bar keeps the
 *   subdomain). The edge function first checks `slug` against the deploy's libraries.
 * - `{ redirect }`: 301 to that URL
 * - `null`: let the request through unchanged
 *
 * On a library subdomain:
 * - `/` and `/catalog/` are the library's pages; other paths without a file
 *   extension rewrite too, and 404 if the library has no such page. A slug that
 *   isn't a library gets the 404 page from the edge function.
 * - `/web/...` and `/api/...` with a file extension, and anything under `/.netlify/`,
 *   pass through (CSS, scripts, images, JSON, functions).
 * - `/web/<page>` without an extension is a main-site page: 301 to the main site.
 * - `/communities/<slug>/...` passes through when it is this library (already rewritten).
 *
 * On the main site's host, `/web/communities/<slug>/...` 301s to the library's subdomain.
 */
export function routeLibraryRequest(url, { libraryDomain, mainSiteUrl: mainOrigin, basePath = '/web/' } = {}) {
  const domain = normalizeDomain(libraryDomain);
  if (!domain) return null;

  const { pathname, search } = url;
  const host = url.hostname.toLowerCase();
  const base = basePrefix(basePath);
  const slug = librarySlugForHost(host, domain);

  if (slug) {
    if (pathname.startsWith('/.netlify/') || pathname.startsWith('/api/')) return null;
    if (pathname.startsWith(base) || `${pathname}/` === base) {
      if (hasExtension(pathname)) return null;
      const main = normalizeOrigin(mainOrigin);
      return main ? { redirect: `${main}${pathname}${search}` } : null;
    }
    if (hasExtension(pathname)) return null;
    const own = `/communities/${slug}`;
    if (pathname === own || pathname.startsWith(`${own}/`)) return null;
    if (!pathname.endsWith('/')) return { redirect: `https://${host}${pathname}/${search}` };
    return { rewrite: `${own}${pathname}${search}`, slug };
  }

  const main = normalizeOrigin(mainOrigin);
  const mainHosts = [domain, `www.${domain}`];
  if (main) mainHosts.push(new URL(main).hostname);
  if (!mainHosts.includes(host)) return null;

  const match = pathname.match(new RegExp(`^${base}communities/([^/]+)(/.*)?$`));
  if (!match) return null;
  const target = match[1].toLowerCase();
  if (!SLUG.test(target) || target.length > MAX_SLUG || isReservedSlug(target)) return null;
  return { redirect: `https://${target}.${domain}${match[2] ?? '/'}${search}` };
}
