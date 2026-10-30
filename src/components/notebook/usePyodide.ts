import { useCallback, useEffect, useRef, useState } from 'react';
import type { CellOutput } from './notebookStore';

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

type Pending = { resolve: (v: never) => void; reject: (e: Error) => void };

type WorkerOut =
  | { type: 'status'; text: string }
  | { type: 'ready' }
  | { type: 'fatal'; message: string }
  | { type: 'done'; id: number }
  | { type: 'result'; id: number; output: CellOutput; dfInfo: DfInfo | null }
  | { type: 'file'; id: number; bytes: Uint8Array };

export function usePyodide() {
  const [state, setState] = useState<PyodideState>('idle');
  const [status, setStatus] = useState('');
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<number, Pending>());
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
        case 'done':
        case 'result':
        case 'file': {
          const p = pending.current.get(m.id);
          if (!p) break;
          pending.current.delete(m.id);
          if (m.type === 'done') (p.resolve as () => void)();
          else if (m.type === 'file') (p.resolve as (v: Uint8Array) => void)(m.bytes);
          else (p.resolve as (v: RunResult) => void)({ output: m.output, dfInfo: m.dfInfo });
          break;
        }
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

  const request = useCallback(<T,>(msg: Record<string, unknown>, transfer: Transferable[] = []) => {
    return new Promise<T>((resolve, reject) => {
      const worker = workerRef.current;
      if (!worker) {
        reject(new Error('Python has not been started'));
        return;
      }
      const id = nextId.current++;
      pending.current.set(id, { resolve: resolve as (v: never) => void, reject });
      worker.postMessage({ ...msg, id }, transfer);
    });
  }, []);

  const writeFile = useCallback(
    (name: string, bytes: Uint8Array) => request<void>({ type: 'writeFile', name, bytes }, [bytes.buffer]),
    [request],
  );
  const run = useCallback((code: string) => request<RunResult>({ type: 'run', code }), [request]);
  const exportDf = useCallback(
    (format: 'csv' | 'xlsx') => request<Uint8Array>({ type: 'export', format }),
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
    },
    [],
  );

  return { state, status, start, writeFile, run, exportDf, restart };
}
