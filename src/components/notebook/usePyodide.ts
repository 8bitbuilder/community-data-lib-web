import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellOutput } from './notebookStore';
import {
  settleReply,
  type PendingEntry,
  type PendingKind,
  type WorkerOut,
  type WriteFileFormat,
} from './pyodideProtocol';

export interface DfColumn {
  name: string;
  dtype: string;
  numeric: boolean;
  missing: number;
}
export interface DfInfo {
  rows: number;
  cols: number;
  columns: DfColumn[];
  head: { columns: string[]; rows: string[][] };
}

export type PyodideState = 'idle' | 'loading' | 'ready' | 'error';
export interface RunResult {
  output: CellOutput;
  dfInfo: DfInfo | null;
}

export function usePyodide() {
  const [state, setState] = useState<PyodideState>('idle');
  const [status, setStatus] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, PendingEntry>());
  const nextId = useRef(1);

  const rejectAll = useCallback((message: string) => {
    for (const p of pending.current.values()) p.reject(new Error(message));
    pending.current.clear();
  }, []);

  const spawn = useCallback(() => {
    const worker = new Worker(new URL('./pyodideWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setState('loading');
    setStatus('Loading Python…');
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      if (workerRef.current !== worker) return;
      const m = ev.data;
      switch (m.type) {
        case 'status':
          setStatus(m.text);
          break;
        case 'ready':
          setState('ready');
          setStatus('');
          break;
        case 'fatal':
          setState('error');
          setStatus(m.message);
          rejectAll(m.message);
          break;
        default:
          settleReply(pending.current, m);
          break;
      }
    };
    worker.onerror = (ev) => {
      if (workerRef.current !== worker) return;
      setState('error');
      setStatus(ev.message || 'Worker error');
      rejectAll(ev.message || 'Worker error');
    };
    worker.postMessage({ type: 'init' });
  }, [rejectAll]);

  const start = useCallback(() => {
    if (!workerRef.current) spawn();
  }, [spawn]);

  const request = useCallback(
    <T,>(kind: PendingKind, msg: Record<string, unknown>, transfer: Transferable[] = []) => {
      return new Promise<T>((resolve, reject) => {
        const worker = workerRef.current;
        if (!worker) {
          reject(new Error('Python has not been started'));
          return;
        }
        const id = nextId.current++;
        pending.current.set(id, { kind, resolve: resolve as (v: unknown) => void, reject });
        try {
          worker.postMessage({ ...msg, type: kind, id }, transfer);
        } catch (e) {
          pending.current.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    [],
  );

  const writeFile = useCallback(
    (name: string, bytes: Uint8Array, format?: WriteFileFormat) => {
      // Transfer a copy so the caller keeps its own buffer (needed to re-write after restart).
      const copy = bytes.slice();
      return request<void>('writeFile', { name, bytes: copy, format }, [copy.buffer]);
    },
    [request],
  );
  const run = useCallback((code: string) => request<RunResult>('run', { code }), [request]);
  const exportDf = useCallback(
    (format: 'csv' | 'xlsx') => request<Uint8Array>('export', { format }),
    [request],
  );

  const restart = useCallback(async () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    rejectAll('Stopped');
    spawn();
  }, [rejectAll, spawn]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      rejectAll('Stopped');
    },
    [rejectAll],
  );

  return { state, status, start, writeFile, run, exportDf, restart };
}
