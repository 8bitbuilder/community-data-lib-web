// The notebook itself, loaded lazily by Notebook.tsx when "Open notebook" is clicked.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, fetchSourceFile, type BackendSource, type ExcelLayout } from '@lib/api/backend';
import { clearSaved, loadSavedCode, markStaleFrom, newCell, restoreCells, saveCode, type CellState } from './notebookStore';
import {
  detectEncoding,
  errorMessage,
  isExcel,
  loadCodeFor,
  textFormat,
  uploadKind,
  type NotebookFile,
} from './notebookFiles';
import { catalogLayout, readLayout } from './notebookExcel';
import { safeFileName } from './pyodideProtocol';
import { usePyodide, type DfInfo } from './usePyodide';
import { useNotebookRunner } from './useNotebookRunner';
import ActionMenu from './ActionMenu';
import Cell from './Cell';
import DataView from './DataView';
import ExportMenu from './ExportMenu';
import UploadZone, { UNSUPPORTED_FILE } from './UploadZone';

export type { NotebookFile } from './notebookFiles';

/** What the Task 10 "+ Cleaning step ▾" menu needs from the notebook. */
export interface CleaningSlotProps {
  dfInfo: DfInfo | null | undefined;
  /** Inserts a cell after the focused cell (or at the end) and runs it. Ignored during Run all. */
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

function CleaningStepSlot({ dfInfo, insertCellAndRun, disabled }: CleaningSlotProps) {
  return (
    <ActionMenu
      columns={dfInfo?.columns ?? []}
      rows={dfInfo?.rows ?? 0}
      disabled={disabled || !dfInfo}
      disabledReason={dfInfo ? 'Wait for Run all to finish' : 'Load the data first'}
      onInsert={insertCellAndRun}
    />
  );
}

const TOO_LARGE =
  'This file is too large to open automatically. Download it with the button above, then use "Use my own file".';
const RESTARTED = 'Python restarted. Run the cells again to rebuild df.';
const LAYOUT_CHANGED = "The preview's sheet or header row changed. Reload data and re-run all steps?";

export default function NotebookPanel({ sourceId, source }: { sourceId: string; source: BackendSource }) {
  const py = usePyodide();
  const { start, writeFile, run, restart, exportDf } = py;

  const [notice, setNotice] = useState('');
  const clearNotice = useCallback(() => setNotice(''), []);
  const runner = useNotebookRunner(run, clearNotice);
  const { cells, cellsRef, setCells, dfInfo, setDfInfo, runningAll, generation, cancel, runCellById, runCell, runAll } =
    runner;

  const [file, setFileState] = useState<NotebookFile | null>(null);
  const fileRef = useRef<NotebookFile | null>(null);
  const setFile = useCallback((f: NotebookFile) => {
    fileRef.current = f;
    setFileState(f);
  }, []);

  const [phase, setPhase] = useState('');
  const [loadError, setLoadError] = useState('');
  const [runAllHint, setRunAllHint] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [pendingLayout, setPendingLayout] = useState<ExcelLayout | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  /** Puts a file into Python and makes the load cell read it, then runs the load cell. */
  const loadFile = useCallback(
    async (f: NotebookFile) => {
      cancel(); // stops a Run all in progress; its later cells must not run against the new df
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
        await writeFile(f.filename, f.bytes, f.format);
      } catch (e) {
        if (gen === generation.current) {
          setLoadError(`Couldn't load the dataset: ${errorMessage(e)}`);
          setUploadOpen(true);
        }
        return;
      }
      if (gen !== generation.current) return;
      const first = cellsRef.current[0];
      if (first) await runCellById(first.id);
    },
    [cancel, cellsRef, generation, runCellById, setCells, setFile, sourceId, writeFile],
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
          archiveEntry: res.archiveEntry,
        };
        if (isExcel(f.format)) f.layout = await catalogLayout(res.bytes, source);
        else f.encoding = detectEncoding(res.bytes);
        setPhase('');
        // The visitor may have uploaded their own file while this was downloading.
        if (!fileRef.current) await loadFile(f);
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
      } else if (cellsRef.current.length > 1) {
        // Later steps may depend on the old columns: ask before re-running them.
        setPendingLayout(layout);
      } else {
        // Only the load cell: nothing to lose, just reload.
        applyLayoutRef.current(layout, false);
      }
    };
    window.addEventListener('cdl:excel-layout', onLayout);
    return () => window.removeEventListener('cdl:excel-layout', onLayout);
  }, [cellsRef]);

  /** Points the load cell at a new sheet / header row, then runs it (and the rest with rerunAll). */
  function applyLayout(layout: ExcelLayout, rerunAll: boolean) {
    const f = fileRef.current;
    if (!f) return;
    cancel(); // so the run below is the only one running
    const next = { ...f, layout };
    setFile(next);
    setPendingLayout(null);
    const code = loadCodeFor(next);
    const first = cellsRef.current[0];
    setCells((cs) => (cs.length ? [{ ...cs[0], code }, ...cs.slice(1)] : cs));
    if (rerunAll) void runAll();
    else if (first) void runCellById(first.id);
  }
  const applyLayoutRef = useRef(applyLayout);
  applyLayoutRef.current = applyLayout;

  function reloadWithLayout() {
    if (pendingLayout) applyLayout(pendingLayout, true);
  }

  /** After Python failed to load: start a fresh worker and load the file into it again. */
  async function retryPython() {
    setLoadError('');
    try {
      await restart();
    } catch (e) {
      setLoadError(`Python couldn't restart: ${errorMessage(e)}`);
      return;
    }
    const f = fileRef.current;
    if (f) await loadFile(f);
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
  }, [cellsRef, codeKey, sourceId]);
  useEffect(() => {
    const flush = () => {
      if (dirty.current && cellsRef.current.length) saveCode(sourceId, cellsRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
  }, [cellsRef, sourceId]);

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

  const insertAfter = runner.insertCellAndRun;
  const insertCellAndRun = useCallback((code: string) => insertAfter(code, activeId), [activeId, insertAfter]);

  async function stop() {
    cancel();
    try {
      await restart();
    } catch (e) {
      setLoadError(`Python couldn't restart: ${errorMessage(e)}`);
      return;
    }
    setCells((cs) => cs.map((c) => ({ ...c, status: 'stale' })));
    setDfInfo(undefined);
    setNotice(RESTARTED);
    const f = fileRef.current;
    if (f) {
      writeFile(f.filename, f.bytes, f.format).catch((e) => setLoadError(`Couldn't load the dataset: ${errorMessage(e)}`));
    }
  }

  function reset() {
    if (!window.confirm('Delete all your cells and start again from the load cell?')) return;
    cancel();
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
    const kind = uploadKind(filename);
    if (!kind) {
      setUploadError(UNSUPPORTED_FILE);
      return;
    }
    let f: NotebookFile;
    try {
      const bytes = new Uint8Array(await upload.arrayBuffer());
      if (kind === 'excel') {
        const layout = await readLayout(bytes, {});
        f = { origin: 'upload', filename, bytes, format: layout.format, archive: null, layout };
      } else {
        const format = textFormat(filename, bytes);
        f = { origin: 'upload', filename, bytes, format, archive: null, encoding: detectEncoding(bytes) };
      }
    } catch (e) {
      setUploadError(`Couldn't read that file: ${errorMessage(e)}`);
      return;
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
    cancel(); // stops a Run all in progress before the load cell changes
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
  const anyRunning = cells.some((c) => c.status === 'running');
  const uploadLayout = file?.origin === 'upload' ? file.layout : undefined;

  return (
    <div className="nb-panel">
      <p className="nb-status" role="status">
        {statusText || notice}
      </p>
      {py.state === 'error' && (
        <button type="button" className="nb-btn" onClick={() => void retryPython()}>
          Try again
        </button>
      )}
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
          onClick={() => {
            setRunAllHint(false);
            void runAll();
          }}
          disabled={!hasCells || runningAll}
        >
          Run all
        </button>
        <button type="button" className="nb-btn" onClick={addCodeCell} disabled={!hasCells}>
          + Code cell
        </button>
        <CleaningStepSlot
          dfInfo={dfInfo}
          insertCellAndRun={insertCellAndRun}
          disabled={!hasCells || runningAll}
        />
        <ExportMenu
          sourceId={sourceId}
          source={source}
          file={file}
          cells={cells}
          exportDf={exportDf}
          disabled={!hasCells || runningAll || anyRunning}
          disabledReason={hasCells ? 'Wait for the running cell to finish' : 'Load the data first'}
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
            runDisabled={runningAll}
            onChange={(code) => changeCode(cell.id, code)}
            onRun={() => runCell(cell.id)}
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
