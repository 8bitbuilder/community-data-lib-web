// Notebook cell state, localStorage persistence and cell-list helpers.
// Pure TypeScript: no React, no DOM beyond the optional localStorage global.

export interface CellState {
  id: string;
  code: string;
  status: 'idle' | 'running' | 'ok' | 'error' | 'stale';
  output?: CellOutput;
}

export type CellOutput = {
  stdout: string;
  error?: { name: string; message: string; traceback: string };
  table?: { columns: string[]; rows: string[][] };
  text?: string;
};

export function storageKey(sourceId: string): string {
  return `cdl-notebook:v1:${sourceId}`;
}

function getStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Returns the saved code for cells after the load cell, or null if nothing
// usable is stored (missing, unreadable, corrupt or wrong shape).
export function loadSavedCode(sourceId: string): string[] | null {
  try {
    const raw = getStorage()?.getItem(storageKey(sourceId));
    if (raw == null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((c) => typeof c === 'string')) return null;
    return parsed as string[];
  } catch {
    return null;
  }
}

// Saves the code of every cell except the load cell (cells[0]).
export function saveCode(sourceId: string, cells: CellState[]): void {
  try {
    getStorage()?.setItem(storageKey(sourceId), JSON.stringify(cells.slice(1).map((c) => c.code)));
  } catch {
    // Storage unavailable or full: persistence is best-effort.
  }
}

export function clearSaved(sourceId: string): void {
  try {
    getStorage()?.removeItem(storageKey(sourceId));
  } catch {
    // Best-effort, see saveCode.
  }
}

// A freshly generated load cell followed by the saved cells, all idle.
export function restoreCells(loadCode: string, saved: string[] | null): CellState[] {
  return [newCell(loadCode), ...(saved ?? []).map((code) => newCell(code))];
}

// Returns a new array in which cells after `index` that have run (ok or error)
// become stale. Other cells, and cells at or before `index`, are unchanged.
export function markStaleFrom(cells: CellState[], index: number): CellState[] {
  return cells.map((c, i) =>
    i > index && (c.status === 'ok' || c.status === 'error') ? { ...c, status: 'stale' } : c,
  );
}

let idCounter = 0;

export function newCell(code = ''): CellState {
  return { id: makeId(), code, status: 'idle' };
}

function makeId(): string {
  idCounter += 1;
  const random =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 10);
  return `cell-${idCounter}-${random}`;
}
