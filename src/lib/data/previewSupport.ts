/**
 * Whether the Data Preview page can show a live table and chart for a source.
 *
 * Mirrors what the preview API supports (backend/lib/csvCache.mjs): a direct
 * download of CSV/TSV/Excel, or a zip containing one. Sources that only link to a
 * provider's website are shown as info only.
 */

export interface PreviewableSource {
  download?: { url?: string | null } | null;
}

/** Returns null when the source can be previewed, otherwise a reason for visitors. */
export function previewUnavailableReason(source: PreviewableSource): string | null {
  const url = source.download?.url?.trim();
  if (!url) {
    return "This dataset is hosted on the provider's website rather than as a downloadable file, so it can't be previewed here.";
  }
  return null;
}
