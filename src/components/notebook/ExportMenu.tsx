// "Export ▾" menu: cleaned data as CSV / Excel, or the notebook as a runnable .ipynb.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { BackendSource } from '@lib/api/backend';
import type { CellState } from './notebookStore';
import { errorMessage, readSpecFor, type NotebookFile } from './notebookFiles';
import { EXPORT_MIME, exportFilename, exportSourceFor, notebookJson, type ExportKind } from './exportPlan';

interface Props {
  sourceId: string;
  source: BackendSource;
  file: NotebookFile | null;
  cells: CellState[];
  exportDf: (format: 'csv' | 'xlsx') => Promise<Uint8Array>;
  disabled: boolean;
  /** Tooltip explaining why the menu is disabled. */
  disabledReason?: string;
}

const ITEMS: { kind: ExportKind; label: string }[] = [
  { kind: 'csv', label: 'Cleaned data (CSV)' },
  { kind: 'xlsx', label: 'Cleaned data (Excel)' },
  { kind: 'ipynb', label: 'Notebook (.ipynb)' },
];

function download(data: BlobPart, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export default function ExportMenu({ sourceId, source, file, cells, exportDf, disabled, disabledReason }: Props) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('focusin', away);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('focusin', away);
    };
  }, [open]);

  useEffect(() => {
    if (open) rootRef.current?.querySelector<HTMLElement>('.nb-action-list button')?.focus();
  }, [open]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    }
  };

  async function choose(kind: ExportKind) {
    setOpen(false);
    setError('');
    if (!file) return;
    const name = exportFilename(kind, sourceId);
    setBusy(true);
    try {
      if (kind === 'ipynb') {
        const src = exportSourceFor(file, source.download?.url);
        download(notebookJson(cells.map((c) => c.code), src, readSpecFor(file)), EXPORT_MIME.ipynb, name);
      } else {
        const bytes = await exportDf(kind);
        download(new Uint8Array(bytes), EXPORT_MIME[kind], name);
      }
    } catch (e) {
      setError(`Couldn't export: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
      // The button was disabled while exporting, so focus fell to the page; give it back.
      requestAnimationFrame(() => buttonRef.current?.focus());
    }
  }

  return (
    <div className="nb-actions" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="nb-btn"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        disabled={disabled || busy}
        title={disabled ? disabledReason : undefined}
        onClick={() => {
          setError('');
          setOpen((o) => !o);
        }}
      >
        {busy ? 'Exporting…' : 'Export ▾'}
      </button>
      {open && (
        <ul className="nb-action-list nb-action-list--end" id={`${uid}-list`}>
          {ITEMS.map((m) => (
            <li key={m.kind}>
              <button type="button" className="nb-action-item" onClick={() => void choose(m.kind)}>
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p className="nb-error-text" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
