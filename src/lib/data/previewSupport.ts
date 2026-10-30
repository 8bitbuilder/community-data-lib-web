/**
 * Whether the Data Preview page can show a table and chart for a source.
 *
 * Previews are static files written by the backend (pythonscripts/export_previews.py);
 * its previews/index.json says, per source, whether a preview exists and if not why.
 * Sources that only link to a provider's website, or whose download the exporter
 * can't read, are shown as info only.
 */

export interface PreviewableSource {
  download?: { url?: string | null } | null;
}

export interface PreviewStatus {
  status: 'ok' | 'none';
  reason?: string;
}

/**
 * Returns null when the source has a preview, otherwise a reason for visitors.
 * `preview` is the source's entry in previews/index.json; undefined means this
 * build has no preview files (built without the backend checkout).
 */
export function previewUnavailableReason(source: PreviewableSource, preview?: PreviewStatus | null): string | null {
  const url = source.download?.url?.trim();
  if (!url) {
    return "This dataset is hosted on the provider's website rather than as a downloadable file, so it can't be previewed here.";
  }
  if (!preview) {
    return "A preview of this dataset isn't available on this copy of the site. Use the download link to get the data.";
  }
  if (preview.status === 'ok') return null;
  const format = preview.reason?.match(/^unsupported format: (.*)$/)?.[1];
  if (format) {
    return `This dataset's download is in a format the preview can't read (${format.replace(/^zip contains no CSV \((.*)\)$/, 'a zip of $1 files')}). Use the download link to get the data.`;
  }
  return "A preview of this dataset isn't available yet. Use the download link to get the data.";
}
