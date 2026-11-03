// Cell list state and run orchestration for the notebook.
//
// Ordering rules:
// - `generation` is bumped by `cancel()` (Stop, Reset, a new file, a layout
//   change). Results from runs started before that are ignored, and a Run all
//   loop from before it stops.
// - While Run all is in progress, single-cell runs and inserts are refused, so
//   nothing interleaves with the loop.
import { useCallback, useRef, useState } from 'react';
import { markStaleFrom, newCell, type CellState } from './notebookStore';
import { errorMessage } from './notebookFiles';
import type { DfInfo, RunResult } from './usePyodide';

export function useNotebookRunner(run: (code: string) => Promise<RunResult>, onRunStart?: () => void) {
  const [cells, setCellsState] = useState<CellState[]>([]);
  const cellsRef = useRef<CellState[]>([]);
  const setCells = useCallback((fn: (cells: CellState[]) => CellState[]) => {
    cellsRef.current = fn(cellsRef.current);
    setCellsState(cellsRef.current);
  }, []);

  const [dfInfo, setDfInfo] = useState<DfInfo | null | undefined>(undefined);
  const [runningAll, setRunningAllState] = useState(false);
  const runningAllRef = useRef(false);
  const setRunningAll = useCallback((v: boolean) => {
    runningAllRef.current = v;
    setRunningAllState(v);
  }, []);

  const generation = useRef(0);
  const startRef = useRef(onRunStart);
  startRef.current = onRunStart;

  /** Invalidates in-flight runs and stops Run all. Cells shown as running become stale. */
  const cancel = useCallback(() => {
    generation.current += 1;
    setRunningAll(false);
    setCells((cs) => (cs.some((c) => c.status === 'running') ? cs.map((c) => (c.status === 'running' ? { ...c, status: 'stale' } : c)) : cs));
  }, [setCells, setRunningAll]);

  /** Runs one cell regardless of Run all; resolves to true when it ran without error. */
  const runCellById = useCallback(
    async (id: string): Promise<boolean> => {
      const gen = generation.current;
      const index = cellsRef.current.findIndex((c) => c.id === id);
      if (index < 0) return false;
      const code = cellsRef.current[index].code;
      startRef.current?.();
      setCells((cs) => markStaleFrom(cs, index).map((c) => (c.id === id ? { ...c, status: 'running' } : c)));
      try {
        const result = await run(code);
        if (gen !== generation.current) return false;
        const ok = !result.output.error;
        setCells((cs) =>
          cs.map((c) => (c.id === id ? { ...c, status: ok ? 'ok' : 'error', output: result.output } : c)),
        );
        setDfInfo(result.dfInfo);
        return ok;
      } catch (e) {
        if (gen !== generation.current) return false;
        const message = errorMessage(e);
        setCells((cs) =>
          cs.map((c) =>
            c.id === id
              ? { ...c, status: 'error', output: { stdout: '', error: { name: 'Error', message, traceback: message } } }
              : c,
          ),
        );
        return false;
      }
    },
    [run, setCells],
  );

  /** A user-requested single run; ignored while Run all is in progress. */
  const runCell = useCallback(
    (id: string) => {
      if (runningAllRef.current) return;
      void runCellById(id);
    },
    [runCellById],
  );

  /** Runs every cell from the top, stopping at the first error. */
  const runAll = useCallback(async () => {
    if (runningAllRef.current) return;
    const gen = generation.current;
    setRunningAll(true);
    try {
      for (const id of cellsRef.current.map((c) => c.id)) {
        if (gen !== generation.current) break;
        if (!(await runCellById(id))) break;
      }
    } finally {
      if (gen === generation.current) setRunningAll(false);
    }
  }, [runCellById, setRunningAll]);

  /** Inserts a cell after `afterId` (or at the end) and runs it; ignored during Run all. */
  const insertCellAndRun = useCallback(
    (code: string, afterId: string | null) => {
      if (runningAllRef.current) return;
      const cell = newCell(code);
      setCells((cs) => {
        const at = cs.findIndex((c) => c.id === afterId);
        const index = at < 0 ? cs.length : at + 1;
        return [...cs.slice(0, index), cell, ...cs.slice(index)];
      });
      void runCellById(cell.id);
    },
    [runCellById, setCells],
  );

  return {
    cells,
    cellsRef,
    setCells,
    dfInfo,
    setDfInfo,
    runningAll,
    generation,
    cancel,
    runCellById,
    runCell,
    runAll,
    insertCellAndRun,
  };
}
