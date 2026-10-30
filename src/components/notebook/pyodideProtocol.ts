// Pure message-routing for the Pyodide worker protocol (no DOM, testable in Node).
import type { CellOutput } from './notebookStore';
import type { DfInfo } from './usePyodide';

export type WorkerOut =
  | { type: 'status'; text: string }
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'done'; id: number }
  | { type: 'result'; id: number; output: CellOutput; dfInfo: DfInfo | null }
  | { type: 'file'; id: number; bytes: Uint8Array }
  | { type: 'error'; id?: number; message: string };

export type PendingKind = 'writeFile' | 'run' | 'export';
export interface PendingEntry {
  kind: PendingKind;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

// Settles the pending request a worker reply belongs to. Replies of the wrong
// shape for the request kind reject instead of resolving with the wrong type.
export function settleReply(pending: Map<number, PendingEntry>, m: WorkerOut): void {
  if (m.type !== 'done' && m.type !== 'result' && m.type !== 'file' && m.type !== 'error') return;
  if (m.id === undefined) return;
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.type === 'error') p.reject(new Error(m.message));
  else if (m.type === 'done' && p.kind === 'writeFile') p.resolve(undefined);
  else if (m.type === 'file' && p.kind === 'export') p.resolve(m.bytes);
  else if (m.type === 'result' && p.kind === 'run') p.resolve({ output: m.output, dfInfo: m.dfInfo });
  else p.reject(new Error(`Unexpected '${m.type}' reply to ${p.kind} request`));
}

/** The file format sent with a writeFile request (the detected format, not the file name). */
export type WriteFileFormat = 'csv' | 'tsv' | 'xlsx' | 'xls';

/**
 * pandas needs xlrd for legacy .xls files. Trust the detected format (catalog files may
 * have no extension; uploads may be "TABLE1.XLS"); fall back to a case-insensitive suffix.
 */
export function needsXlrd(name: string, format?: WriteFileFormat): boolean {
  if (format) return format === 'xls';
  return name.toLowerCase().endsWith('.xls');
}

// Basename only; null if nothing usable remains.
export function safeFileName(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? '';
  return base === '' || base === '.' || base === '..' ? null : base;
}
