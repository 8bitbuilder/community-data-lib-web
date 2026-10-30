// The notebook itself, loaded lazily by Notebook.tsx when "Open notebook" is clicked.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchSourceFile, type BackendSource, type ExcelLayout } from '@lib/api/backend';
import { loadCell, type FileFormat, type ReadSpec } from './codegen';
import {
  clearSaved,
  loadSavedCode,
  markStaleFrom,
  newCell,
  restoreCells,
  saveCode,
  type CellState,
} from './notebookStore';
import { safeFileName } from './pyodideProtocol';
import { usePyodide, type DfInfo } from './usePyodide';
import Cell from './Cell';
import DataView from './DataView';
import UploadZone from './UploadZone';

/** The file currently loaded into Python's filesystem. */
export interface NotebookFile {
  origin: 'catalog' | 'upload';
  filename: string;
  bytes: Uint8Array;
  format: FileFormat;
  /** Catalog files only: the server unzipped this file from a zip download. */
  archive: 'zip' | null;
  encoding?: 'utf-8' | 'latin-1';
  /** Excel only: the sheet / header row / data region the load cell reads. */
  layout?: ExcelLayout;
}

/** What the Task 10 "+ Cleaning step ▾" menu needs from the notebook. */
export interface CleaningSlotProps {
  dfInfo: DfInfo | null | undefined;
  /** Inserts a cell after the focused cell (or at the end) and runs it. */
  insertCellAndRun: (code: string) => void;
  disabled: boolean;
}

/** What the Task 11 "Export ▾" menu needs from the notebook. */
export interface ExportSlotProps {
  sourceId: string;
  source: BackendSource;
  file: NotebookFile | null;
  cells: CellState[];
  exportDf: (format: 'csv' | 'xlsx') => Promise<Uint8Array>;
  disabled: boolean;
}

// Placeholder for Task 10, which replaces this with the guided-actions menu.
function CleaningStepSlot(_props: CleaningSlotProps) {
  return (
    <button type="button" className="nb-btn" disabled title="Coming soon">
      + Cleaning step ▾
    </button>
  );
}

// Placeholder for Task 11, which replaces this with the export menu.
function ExportSlot(_props: ExportSlotProps) {
  return (
    <button type="button" className="nb-btn" disabled title="Coming soon">
      Export ▾
    </button>
  );
}

const TOO_LARGE =
  'This file is too large to open automatically. Download it with the button above, then use "Use my own file".';
const RESTARTED = 'Python restarted. Run the cells again to rebuild df.';
const LAYOUT_CHANGED = "The preview's sheet or header row changed. Reload data and re-run all steps?";

function isExcel(format: FileFormat): boolean {
  return format === 'xlsx' || format === 'xls';
}

function detectEncoding(bytes: Uint8Array): 'utf-8' | 'latin-1' {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return 'utf-8';
  } catch {
    return 'latin-1';
  }
}

function readSpecFor(file: NotebookFile): ReadSpec {
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

function loadCodeFor(file: NotebookFile): string {
  return loadCell({ kind: 'file', filename: file.filename }, readSpecFor(file));
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type ExcelModule = typeof import('@lib/data/excelLayout.mjs');
let excelModule: Promise<ExcelModule> | null = null;
function loadExcelModule(): Promise<ExcelModule> {
  excelModule ??= import('@lib/data/excelLayout.mjs');
  return excelModule;
}

async function readLayout(
  bytes: Uint8Array,
  options: Parameters<ExcelModule['readExcelTable']>[1],
): Promise<ExcelLayout> {
  const { readExcelTable } = await loadExcelModule();
  return readExcelTable(bytes, options).layout as ExcelLayout;
}

function pageExcelLayout(): ExcelLayout | undefined {
  return (window as unknown as { __cdlExcelLayout?: ExcelLayout }).__cdlExcelLayout;
}

/** The catalog file's Excel layout: the preview's, or worked out here if the preview hasn't loaded. */
async function catalogLayout(bytes: Uint8Array, source: BackendSource): Promise<ExcelLayout> {
  const fromPage = pageExcelLayout();
  if (fromPage) return fromPage;
  const params = new URLSearchParams(window.location.search);
  const headerRow = Number.parseInt(params.get('header_row') ?? '', 10);
  return readLayout(bytes, {
    visitor: {
      sheet: params.get('sheet') || undefined,
      headerRow: Number.isInteger(headerRow) && headerRow > 0 ? headerRow : undefined,
    },
    curator: { sheet: source.download?.sheet, headerRow: source.download?.header_row },
  });
}

function textFormat(name: string, bytes: Uint8Array): 'csv' | 'tsv' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.tsv')) return 'tsv';
  if (lower.endsWith('.txt')) {
    const firstLine = new TextDecoder('latin1').decode(bytes.subarray(0, 4096)).split(/\r?\n/)[0] ?? '';
    if (firstLine.includes('\t') && !firstLine.includes(',')) return 'tsv';
  }
  return 'csv';
}

export default function NotebookPanel({ sourceId, source }: { sourceId: string; source: BackendSource }) {
  const py = usePyodide();
  const { start, writeFile, run, restart, exportDf } = py;

  const [cells, setCellsState] = useState<CellState[]>([]);
  const cellsRef = useRef<CellState[]>([]);
  const setCells = useCallback((fn: (cells: CellState[]) => CellState[]) => {
    cellsRef.current = fn(cellsRef.current);
    setCellsState(cellsRef.current);
  }, []);

  const [file, setFileState] = useState<NotebookFile | null>(null);
  const fileRef = useRef<NotebookFile | null>(null);
  const setFile = useCallback((f: NotebookFile) => {
    fileRef.current = f;
    setFileState(f);
  }, []);

  const [dfInfo, setDfInfo] = useState<DfInfo | null | undefined>(undefined);
  const [phase, setPhase] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [runAllHint, setRunAllHint] = useState(false);
  const [runningAll, setRunningAll] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pendingLayout, setPendingLayout] = useState<ExcelLayout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // Bumped by Stop/Reset so results from before it are ignored.
  const generation = useRef(0);

  const runCellById = useCallback(
    async (id: string): Promise<boolean> => {
      const gen = generation.current;
      const index = cellsRef.current.findIndex((c) => c.id === id);
      if (index < 0) return false;
      const code = cellsRef.current[index].code;
      setNotice('');
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

  const runAll = useCallback(async () => {
    const gen = generation.current;
    setRunAllHint(false);
    setRunningAll(true);
    try {
      for (const id of cellsRef.current.map((c) => c.id)) {
        if (gen !== generation.current) break;
        if (!(await runCellById(id))) break;
      }
    } finally {
      if (gen === generation.current) setRunningAll(false);
    }
  }, [runCellById]);

  /** Puts a file into Python and makes the load cell read it, then runs the load cell. */
  const loadFile = useCallback(
    async (f: NotebookFile) => {
      setFile(f);
      setPendingLayout(null);
      const code = loadCodeFor(f);
      if (cellsRef.current.length === 0) {
        const restored = restoreCells(code, loadSavedCode(sourceId));
        setCells(() => restored);
        setRunAllHint(restored.length > 1);
      } else {
        // Replace the load cell; keep later cells but mark them out of date.
        setCells((cs) => markStaleFrom([{ ...cs[0], code, status: 'idle', output: undefined }, ...cs.slice(1)], 0));
      }
      const gen = generation.current;
      try {
        await writeFile(f.filename, f.bytes);
      } catch (e) {
        if (gen === generation.current) setLoadError(`Couldn't load the dataset: ${errorMessage(e)}`);
        return;
      }
      if (gen !== generation.current) return;
      const first = cellsRef.current[0];
      if (first) await runCellById(first.id);
    },
    [runCellById, setCells, setFile, sourceId, writeFile],
  );

  // On open: start Python and fetch the catalog file in parallel.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    start();
    (async () => {
      setPhase('Loading dataset…');
      try {
        const res = await fetchSourceFile(sourceId);
        const f: NotebookFile = {
          origin: 'catalog',
          filename: safeFileName(res.filename) ?? `data.${res.format}`,
          bytes: res.bytes,
          format: res.format,
          archive: res.archive,
        };
        if (isExcel(f.format)) f.layout = await catalogLayout(res.bytes, source);
        else f.encoding = detectEncoding(res.bytes);
        setPhase('');
        await loadFile(f);
      } catch (e) {
        setPhase('');
        setLoadError(
          e instanceof ApiError && e.status === 413 ? TOO_LARGE : `Couldn't load the dataset: ${errorMessage(e)}`,
        );
        setUploadOpen(true);
      }
    })();
  }, [source, sourceId, start, loadFile]);

  // The preview's Excel sheet / header row changed while the notebook is open.
  useEffect(() => {
    const onLayout = (ev: Event) => {
      const layout = (ev as CustomEvent<ExcelLayout>).detail;
      const f = fileRef.current;
      if (!layout || !f || f.origin !== 'catalog' || !isExcel(f.format)) return;
      const code = loadCodeFor({ ...f, layout });
      if (code === cellsRef.current[0]?.code) {
        setPendingLayout(null);
        return;
      }
      setPendingLayout(layout);
    };
    window.addEventListener('cdl:excel-layout', onLayout);
    return () => window.removeEventListener('cdl:excel-layout', onLayout);
  }, []);

  function reloadWithLayout() {
    const f = fileRef.current;
    if (!f || !pendingLayout) return;
    const next = { ...f, layout: pendingLayout };
    setFile(next);
    setPendingLayout(null);
    const code = loadCodeFor(next);
    setCells((cs) => (cs.length ? [{ ...cs[0], code }, ...cs.slice(1)] : cs));
    void runAll();
  }

  // Save cell code (not outputs) 500 ms after the last change, and when leaving the page.
  const codeKey = JSON.stringify(cells.map((c) => c.code));
  const dirty = useRef(false);
  useEffect(() => {
    if (cellsRef.current.length === 0) return;
    dirty.current = true;
    const t = window.setTimeout(() => {
      saveCode(sourceId, cellsRef.current);
      dirty.current = false;
    }, 500);
    return () => window.clearTimeout(t);
  }, [codeKey, sourceId]);
  useEffect(() => {
    const flush = () => {
      if (dirty.current && cellsRef.current.length) saveCode(sourceId, cellsRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [sourceId]);

  function changeCode(id: string, code: string) {
    const index = cellsRef.current.findIndex((c) => c.id === id);
    if (index < 0 || cellsRef.current[index].code === code) return; // echo of an outside change
    setCells((cs) => markStaleFrom(cs.map((c, i) => (i === index ? { ...c, code } : c)), index));
  }

  function moveCell(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (index < 1 || target < 1 || target >= cellsRef.current.length) return;
    setCells((cs) => {
      const next = [...cs];
      [next[index], next[target]] = [next[target], next[index]];
      return markStaleFrom(next, Math.min(index, target) - 1);
    });
  }

  function deleteCell(index: number) {
    if (index < 1) return;
    setCells((cs) => markStaleFrom(cs.filter((_, i) => i !== index), index - 1));
  }

  function addCodeCell() {
    const cell = newCell('');
    setCells((cs) => [...cs, cell]);
    setFocusId(cell.id);
  }

  const insertCellAndRun = useCallback(
    (code: string) => {
      const cell = newCell(code);
      setCells((cs) => {
        const at = cs.findIndex((c) => c.id === activeId);
        const index = at < 0 ? cs.length : at + 1;
        return [...cs.slice(0, index), cell, ...cs.slice(index)];
      });
      void runCellById(cell.id);
    },
    [activeId, runCellById, setCells],
  );

  async function stop() {
    generation.current += 1;
    setRunningAll(false);
    await restart();
    setCells((cs) => cs.map((c) => ({ ...c, status: 'stale' })));
    setDfInfo(undefined);
    setNotice(RESTARTED);
    const f = fileRef.current;
    if (f) {
      writeFile(f.filename, f.bytes).catch((e) => setLoadError(`Couldn't load the dataset: ${errorMessage(e)}`));
    }
  }

  function reset() {
    if (!window.confirm('Delete all your cells and start again from the load cell?')) return;
    generation.current += 1;
    setRunningAll(false);
    setRunAllHint(false);
    setNotice('');
    clearSaved(sourceId);
    const f = fileRef.current;
    if (!f) {
      setCells(() => []);
      return;
    }
    const load = newCell(loadCodeFor(f));
    setCells(() => [load]);
    void runCellById(load.id);
  }

  async function onUpload(upload: File) {
    setUploadError('');
    const filename = safeFileName(upload.name);
    if (!filename) {
      setUploadError("That file name can't be used. Rename the file and try again.");
      return;
    }
    const bytes = new Uint8Array(await upload.arrayBuffer());
    const lower = filename.toLowerCase();
    let f: NotebookFile;
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      try {
        const layout = await readLayout(bytes, {});
        f = { origin: 'upload', filename, bytes, format: layout.format, archive: null, layout };
      } catch (e) {
        setUploadError(`Couldn't read that Excel file: ${errorMessage(e)}`);
        return;
      }
    } else {
      f = {
        origin: 'upload',
        filename,
        bytes,
        format: textFormat(filename, bytes),
        archive: null,
        encoding: detectEncoding(bytes),
      };
    }
    setLoadError('');
    setUploadOpen(false);
    await loadFile(f);
  }

  // Sheet / header row selects for an uploaded Excel file.
  async function changeUploadLayout(sheet: string, headerRow?: number) {
    const f = fileRef.current;
    if (!f || f.origin !== 'upload' || !f.layout) return;
    let layout: ExcelLayout;
    try {
      layout = await readLayout(f.bytes, { visitor: { sheet, headerRow } });
    } catch (e) {
      setUploadError(`Couldn't read that sheet: ${errorMessage(e)}`);
      return;
    }
    setUploadError('');
    const next = { ...f, layout };
    setFile(next);
    const code = loadCodeFor(next);
    setCells((cs) => markStaleFrom([{ ...cs[0], code }, ...cs.slice(1)], 0));
    const first = cellsRef.current[0];
    if (first) await runCellById(first.id);
  }

  const pyStatus =
    py.state === 'loading' ? py.status : py.state === 'error' ? `Python couldn't start: ${py.status}` : '';
  const statusText = [pyStatus, phase].filter(Boolean).join(' ');
  const hasCells = cells.length > 0;
  const uploadLayout = file?.origin === 'upload' ? file.layout : undefined;

  return (
    <div className="nb-panel">
      <p className="nb-status" role="status">
        {statusText || notice}
      </p>
      {loadError && (
        <p className="nb-error-text" role="alert">
          {loadError}
        </p>
      )}
      {pendingLayout && (
        <div className="nb-prompt" role="alert">
          <p>{LAYOUT_CHANGED}</p>
          <div className="nb-prompt-actions">
            <button type="button" className="nb-btn nb-btn--primary" onClick={reloadWithLayout}>
              Reload
            </button>
            <button type="button" className="nb-btn" onClick={() => setPendingLayout(null)}>
              Keep current
            </button>
          </div>
        </div>
      )}

      <div className="nb-file-row">
        {file && (
          <p className="nb-file">
            File: <code>{file.filename}</code>
            {file.origin === 'upload' ? ' (your file)' : ''}
          </p>
        )}
        <UploadZone
          expanded={uploadOpen}
          onToggle={() => setUploadOpen((o) => !o)}
          onFile={(f) => void onUpload(f)}
          error={uploadError}
        />
      </div>
      {uploadLayout && (
        <div className="nb-excel-controls">
          <label className="nb-field">
            <span>Sheet</span>
            <select value={uploadLayout.sheet} onChange={(e) => void changeUploadLayout(e.target.value)}>
              {uploadLayout.sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="nb-field">
            <span>Header row</span>
            <select
              value={String(uploadLayout.headerRow)}
              onChange={(e) => void changeUploadLayout(uploadLayout.sheet, Number(e.target.value))}
            >
              {Array.from({ length: Math.max(20, uploadLayout.headerRow) }, (_, i) => (
                <option key={i} value={String(i + 1)}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="nb-toolbar" role="toolbar" aria-label="Notebook">
        <button
          type="button"
          className="nb-btn nb-btn--primary"
          onClick={() => void runAll()}
          disabled={!hasCells || runningAll}
        >
          Run all
        </button>
        <button type="button" className="nb-btn" onClick={addCodeCell} disabled={!hasCells}>
          + Code cell
        </button>
        <CleaningStepSlot dfInfo={dfInfo} insertCellAndRun={insertCellAndRun} disabled={!hasCells} />
        <ExportSlot
          sourceId={sourceId}
          source={source}
          file={file}
          cells={cells}
          exportDf={exportDf}
          disabled={!hasCells}
        />
        <button type="button" className="nb-btn" onClick={() => void stop()}>
          Stop
        </button>
        <button type="button" className="nb-btn" onClick={reset}>
          Reset
        </button>
      </div>
      {runAllHint && (
        <p className="nb-hint">Your saved cells are back. Click Run all to run them on the data.</p>
      )}

      <DataView info={dfInfo} />

      <div className="nb-cells">
        {cells.map((cell, i) => (
          <Cell
            key={cell.id}
            cell={cell}
            index={i}
            count={cells.length}
            isLoad={i === 0}
            autoFocus={cell.id === focusId}
            onChange={(code) => changeCode(cell.id, code)}
            onRun={() => void runCellById(cell.id)}
            onMoveUp={() => moveCell(i, -1)}
            onMoveDown={() => moveCell(i, 1)}
            onDelete={() => deleteCell(i)}
            onFocus={() => setActiveId(cell.id)}
          />
        ))}
      </div>
    </div>
  );
}
