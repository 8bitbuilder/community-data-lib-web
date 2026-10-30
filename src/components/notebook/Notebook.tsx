// "Clean this data" section on the Data Preview page. This file stays light: the
// notebook itself (CodeMirror, Pyodide worker, SheetJS) is a separate chunk that
// is only downloaded when the visitor clicks "Open notebook".
import { lazy, Suspense, useEffect, useState } from 'react';
import { fetchSource, type BackendSource } from '@lib/api/backend';
import { previewUnavailableReason } from '@lib/data/previewSupport';
import './notebook.css';

const NotebookPanel = lazy(() => import('./NotebookPanel'));

function sourceIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get('source')?.trim() ?? '';
}

export default function Notebook() {
  const [sourceId] = useState(sourceIdFromUrl);
  const [source, setSource] = useState<BackendSource | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!sourceId) return;
    let cancelled = false;
    fetchSource(sourceId)
      .then((s) => {
        if (!cancelled) setSource(s);
      })
      .catch(() => {
        // The page shows its own error for an unknown or unreachable source.
      });
    return () => {
      cancelled = true;
    };
  }, [sourceId]);

  // Hidden until the source is known, and for info-only sources.
  if (!sourceId || !source || previewUnavailableReason(source)) return null;

  return (
    <section className="cdl-notebook panel-card" aria-labelledby="cdl-notebook-title">
      <h2 className="section-title" id="cdl-notebook-title">
        Clean this data
      </h2>
      {open ? (
        <Suspense fallback={<p className="nb-status">Loading notebook…</p>}>
          <NotebookPanel sourceId={sourceId} source={source} />
        </Suspense>
      ) : (
        <div className="nb-intro">
          <p>Write and run Python (pandas) right here. The first time takes a few seconds to load.</p>
          <button type="button" className="btn-download" onClick={() => setOpen(true)}>
            Open notebook
          </button>
        </div>
      )}
    </section>
  );
}
