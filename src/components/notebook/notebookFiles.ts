// Pure helpers for the file a notebook reads: format/encoding detection and the
// generated load cell. No React, no DOM (TextDecoder only).
import type { ExcelLayout } from '../../lib/api/backend.ts';
import { loadCell, type FileFormat, type ReadSpec } from './codegen.ts';

/**
 * The file currently loaded into Python's filesystem. Always a file the visitor
 * uploaded: they download datasets from the original provider themselves.
 */
export interface NotebookFile {
  filename: string;
  bytes: Uint8Array;
  format: FileFormat;
  encoding?: 'utf-8' | 'latin-1';
  /** Excel only: the sheet / header row / data region the load cell reads. */
  layout?: ExcelLayout;
}

export const UPLOAD_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx', '.xls'] as const;
export const UPLOAD_ACCEPT = UPLOAD_EXTENSIONS.join(',');

export function isExcel(format: FileFormat): boolean {
  return format === 'xlsx' || format === 'xls';
}

/** 'excel', 'text', or null when the file type isn't supported. */
export function uploadKind(name: string): 'excel' | 'text' | null {
  const lower = name.toLowerCase();
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'excel';
  if (lower.endsWith('.csv') || lower.endsWith('.tsv') || lower.endsWith('.txt')) return 'text';
  return null;
}

export function detectEncoding(bytes: Uint8Array): 'utf-8' | 'latin-1' {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'latin-1';
  }
}

/** .tsv → tsv; .txt → tsv when its first line has tabs but no commas; otherwise csv. */
export function textFormat(name: string, bytes: Uint8Array): 'csv' | 'tsv' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.txt')) {
    const firstLine = new TextDecoder('latin1').decode(bytes.subarray(0, 4096)).split(/\r?\n/)[0] ?? '';
    if (firstLine.includes('\t') && !firstLine.includes(',')) return 'tsv';
  }
  return 'csv';
}

export function readSpecFor(file: Pick<NotebookFile, 'format' | 'encoding' | 'layout'>): ReadSpec {
  if (isExcel(file.format) && file.layout) {
    const l = file.layout;
    return {
      format: file.format,
      sheet: l.sheet,
      headerRow: l.headerRow,
      dataRowCount: l.dataRowCount,
      trimmedRows: l.trimmedRows,
    };
  }
  return { format: file.format, encoding: file.encoding };
}

export function loadCodeFor(file: Pick<NotebookFile, 'filename' | 'format' | 'encoding' | 'layout'>): string {
  return loadCell({ kind: 'file', filename: file.filename }, readSpecFor(file));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
