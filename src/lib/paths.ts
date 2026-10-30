const basePath = import.meta.env.BASE_URL ?? '/';

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
