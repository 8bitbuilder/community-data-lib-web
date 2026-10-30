// Pure logic for the Export menu: where an exported notebook loads its data from,
// which cells it contains, and file names / MIME types. No React, no DOM.
import { loadCell, toIpynb, type LoadSource, type ReadSpec } from './codegen.ts';

export type ExportKind = 'csv' | 'xlsx' | 'ipynb';

export const EXPORT_MIME: Record<ExportKind, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ipynb: 'application/x-ipynb+json',
};

type ExportLoadSource = Exclude<LoadSource, { kind: 'file' }>;

/**
 * Where the exported notebook reads the data from: the same file the visitor
 * uploaded, placed next to the notebook. It never downloads the dataset itself.
 */
export function exportSourceFor(file: { filename: string }): ExportLoadSource {
  return { kind: 'upload', filename: file.filename };
}

/** The notebook's cells: the in-browser load cell is swapped for one that loads from the original source. */
export function notebookCellsFor(codes: string[], source: ExportLoadSource, read: ReadSpec): string[] {
  return [loadCell(source, read), ...codes.slice(1)];
}

export function notebookJson(codes: string[], source: ExportLoadSource, read: ReadSpec): string {
  return toIpynb(notebookCellsFor(codes, source, read));
}

export function exportFilename(kind: ExportKind, sourceId: string): string {
  const base = sourceId.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dataset';
  return kind === 'ipynb' ? `${base}-notebook.ipynb` : `${base}-cleaned.${kind}`;
}
