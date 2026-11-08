// "Clean this data" section on the Data Preview page. This file stays light: the
// notebook itself (CodeMirror, Pyodide worker, SheetJS) is a separate chunk that
// is only downloaded when the visitor clicks "Open notebook".
import { Component, lazy, Suspense, useState, type ReactNode } from 'react';
import type { NotebookSource } from './notebookExcel';
import './notebook.css';

const NotebookPanel = lazy(() => import('./NotebookPanel'));

/** Catches a failed chunk download or a render error in the notebook. */
class NotebookErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <p className="nb-error-text" role="alert">
          Couldn&apos;t load the notebook. Reload the page.
        </p>
      );
    }
    return this.props.children;
  }
}

function sourceIdFromUrl(): string {
  return new URLSearchParams(window.location.search).get('source')?.trim() ?? '';
}

export default function Notebook({ sources }: { sources: Record<string, NotebookSource> }) {
  const [sourceId] = useState(sourceIdFromUrl);
  const [open, setOpen] = useState(false);
  const source = sources[sourceId];

  // Hidden for unknown sources and ones with no file to download. A file the
  // preview can't read can still be uploaded and cleaned here.
  if (!source?.download?.url?.trim()) return null;

  return (
    <section className="cdl-notebook panel-card" aria-labelledby="cdl-notebook-title">
      <h2 className="section-title" id="cdl-notebook-title">
        Clean this data
      </h2>
      {open ? (
        <NotebookErrorBoundary>
          <Suspense fallback={<p className="nb-status">Loading notebook…</p>}>
            <NotebookPanel sourceId={sourceId} source={source} />
          </Suspense>
        </NotebookErrorBoundary>
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
