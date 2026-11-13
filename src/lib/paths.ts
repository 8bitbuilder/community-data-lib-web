import { libraryUrl, mainSiteUrl } from './community/libraryHosts.mjs';

const basePath = import.meta.env.BASE_URL ?? '/';

// Library subdomains (web#31). Both are optional; see docs/technical/netlify.md.
const hostSettings = {
  basePath,
  libraryDomain: import.meta.env.PUBLIC_LIBRARY_DOMAIN,
  mainSiteUrl: import.meta.env.PUBLIC_MAIN_SITE_URL,
};

/**
 * A page of a community library: `https://<slug>.<domain>/catalog/` when
 * PUBLIC_LIBRARY_DOMAIN is set, otherwise `/web/communities/<slug>/catalog/`.
 * `path` is relative to the library's home ('/' or '/catalog/').
 */
export function libraryHref(slug: string, path = '/'): string {
  return libraryUrl(encodeURIComponent(slug), path, hostSettings);
}

/**
 * A main-site page, for links from pages that may be served on a library subdomain.
 * Absolute (PUBLIC_MAIN_SITE_URL) when set, otherwise the same as withBasePath.
 */
export function mainSiteHref(path = '/'): string {
  return mainSiteUrl(path, hostSettings);
}

export function withBasePath(path = '/'): string {
  const normalizedBase = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const normalizedPath = path === '/' ? '' : path.replace(/^\/+/, '');

  if (normalizedPath === '') {
    return normalizedBase;
  }

  return `${normalizedBase}${normalizedPath}`;
}
/**
 * Where a catalog entry links: its Data Preview page when it comes from the
 * backend, otherwise the entry's own URL.
 */
export function catalogEntryHref(entry: { sourceId?: string; url?: string }, audience?: string): string {
  if (!entry.sourceId) {
    return entry.url ?? withBasePath('/complete-catalog');
  }
  const audienceParam = audience ? `&audience=${audience}` : '';
  return withBasePath(`/data-preview?source=${encodeURIComponent(entry.sourceId)}${audienceParam}`);
}
