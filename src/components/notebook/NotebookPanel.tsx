// The notebook itself, loaded lazily by Notebook.tsx when "Open notebook" is clicked.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ExcelLayout } from '@lib/api/backend';
import { clearSaved, loadSavedCode, markStaleFrom, newCell, restoreCells, saveCode } from './notebookStore';
import {
  detectEncoding,
  errorMessage,
  loadCodeFor,
  textFormat,
  uploadKind,
  type NotebookFile,
} from './notebookFiles';
import { readLayout, uploadLayout, type NotebookSource } from './notebookExcel';
import { safeFileName } from './pyodideProtocol';
import { usePyodide, type DfInfo } from './usePyodide';
import { useNotebookRunner } from './useNotebookRunner';
import ActionMenu from './ActionMenu';
import Cell from './Cell';
import DataView from './DataView';
import ExportMenu from './ExportMenu';
import NotebookTabs, { type NotebookTab } from './NotebookTabs';
import UploadZone, { UNSUPPORTED_FILE } from './UploadZone';

export type { NotebookFile } from './notebookFiles';

/** What the Task 10 "+ Cleaning step ▾" menu needs from the notebook. */
export interface CleaningSlotProps {
  dfInfo: DfInfo | null | undefined;
  /** Inserts a cell after the focused cell (or at the end) and runs it. Ignored during Run all. */
  insertCellAndRun: (code: string) => void;
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

/**
 * The notebook never fetches datasets itself: visitors download the file from the
 * original provider (under the provider's terms of use) and upload it here.
 */
function GetTheData({ source }: { source: NotebookSource }) {
  const provider = source.provider?.name || 'the data provider';
  const href = source.download?.url || source.provider?.url;
  return (
    <div className="nb-get-data">
      <p className="nb-get-data-title">To start, get a copy of the data:</p>
      <ol>
        <li>
          Download the dataset from {provider}
          {href && (
            <>
              {': '}
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Go to the download from ${provider} (opens in a new tab)`}
              >
                go to the download ↗
              </a>
            </>
          )}
          . Getting it straight from the source means you use it under their terms.
        </li>
        <li>Upload the file you downloaded below.</li>
      </ol>
    </div>
  );
}

const RESTARTED ='Python restarted. Run the cells again to rebuild df.';

export default function NotebookPanel({ sourceId, source }: { sourceId: string; source: NotebookSource }) {
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

  const [loadError, setLoadError] = useState('');
  const [runAllHint, setRunAllHint] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [tab, setTab] = useState<NotebookTab>('steps');

  /** Puts a file into Python and makes the load cell read it, then runs the load cell. */
  const loadFile = useCallback(
    async (f: NotebookFile) => {
      cancel(); // stops a Run all in progress; its later cells must not run against the new df
      setFile(f);
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


  // On open: start Python. The visitor then uploads the file they downloaded from the provider.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    start();
  }, [start]);

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
    // A new blank cell is for typing, so show it.
    setTab('steps');
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
        const layout = await uploadLayout(bytes, source);
        f = { filename, bytes, format: layout.format, layout };
      } else {
        const format = textFormat(filename, bytes);
        f = { filename, bytes, format, encoding: detectEncoding(bytes) };
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
    if (!f || !f.layout) return;
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
  const statusText = pyStatus;
  const hasCells = cells.length > 0;
  const anyRunning = cells.some((c) => c.status === 'running');
  const errorCount = cells.filter((c) => c.status === 'error').length;
  // Steps after the load cell; the error count is shown so a failed step isn't missed from the data tab.
  const stepsBadge = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'error' : 'errors'}` : String(Math.max(cells.length - 1, 0));
  const dataBadge = dfInfo ? `${dfInfo.rows.toLocaleString()} × ${dfInfo.cols.toLocaleString()}` : undefined;
  const excelLayout = file?.layout;

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
      {!file && <GetTheData source={source} />}
      <div className="nb-file-row">
        {file && (
          <p className="nb-file">
            File: <code>{file.filename}</code>
          </p>
        )}
        <UploadZone
          // Until a file is loaded, uploading is the only way in, so keep the drop area open.
          expanded={!file || uploadOpen}
          hasFile={Boolean(file)}
          onToggle={() => setUploadOpen((o) => !o)}
          onFile={(f) => void onUpload(f)}
          error={uploadError}
        />
      </div>
      {excelLayout && (
        <div className="nb-excel-controls">
          <label className="nb-field">
            <span>Sheet</span>
            <select value={excelLayout.sheet} onChange={(e) => void changeUploadLayout(e.target.value)}>
              {excelLayout.sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="nb-field">
            <span>Header row</span>
            <select
              value={String(excelLayout.headerRow)}
              onChange={(e) => void changeUploadLayout(excelLayout.sheet, Number(e.target.value))}
            >
              {Array.from({ length: Math.max(20, excelLayout.headerRow) }, (_, i) => (
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

      <NotebookTabs
        active={tab}
        onChange={setTab}
        tabs={[
          {
            id: 'steps',
            label: 'Cleaning steps',
            badge: hasCells ? stepsBadge : undefined,
            panel: (
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
            ),
          },
          { id: 'data', label: 'Data preview', badge: dataBadge, panel: <DataView info={dfInfo} /> },
        ]}
      />
    </div>
  );
}
