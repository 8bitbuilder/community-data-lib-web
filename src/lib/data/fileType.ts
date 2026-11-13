/**
 * The file type a dataset downloads as, for the Data Preview tag card (web#43).
 *
 * The backend records it in catalog.json as `download.format`: `csv`, `tsv`, `xlsx`,
 * `xls`, `accdb`, or `zip/<the file inside>` such as `zip/csv` or `zip/accdb`.
 * export_previews.py detects it from the file itself, so it is right even when the
 * URL has no extension or a zip hides what's inside.
 */

export interface DownloadFileType {
  /** Short chip text: "CSV", "XLSX", "ZIP → CSV". */
  label: string;
  /** Sentence for a tooltip or screen reader: "A .zip archive containing a CSV file." */
  description: string;
  /** The file isn't a table a spreadsheet opens directly; visitors must convert it first (web#44). */
  needsConversion: boolean;
}

const TYPE_NAMES: Record<string, string> = {
  csv: 'a CSV file',
  tsv: 'a tab-separated (TSV) file',
  xlsx: 'an Excel workbook (.xlsx)',
  xls: 'an Excel 97–2003 workbook (.xls)',
  accdb: 'a Microsoft Access database (.accdb)',
};

const NEEDS_CONVERSION = new Set(['accdb']);

/** Null when the source has no declared format (no direct download, or not recorded yet). */
export function downloadFileType(format?: string | null): DownloadFileType | null {
  const value = format?.trim().toLowerCase();
  if (!value) return null;
  const [container, inner] = value.includes('/') ? value.split('/', 2) : [null, value];
  if (!inner) return null;
  const name = TYPE_NAMES[inner] ?? `a .${inner} file`;
  const description = container
    ? `A .${container} archive containing ${name}.`
    : `${name.charAt(0).toUpperCase()}${name.slice(1)}.`;
  return {
    label: container ? `${container.toUpperCase()} → ${inner.toUpperCase()}` : inner.toUpperCase(),
    description,
    needsConversion: NEEDS_CONVERSION.has(inner),
  };
}
