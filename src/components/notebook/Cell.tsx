import { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { python } from '@codemirror/lang-python';
import { Compartment, Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { CellState } from './notebookStore';
import { TableView } from './DataView';

export interface CellProps {
  cell: CellState;
  index: number;
  count: number;
  /** The load cell (index 0) can't be moved or deleted. */
  isLoad: boolean;
  autoFocus?: boolean;
  /** True while Run all is in progress: single runs are refused. */
  runDisabled?: boolean;
  onChange: (code: string) => void;
  onRun: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onFocus: () => void;
}

const STATUS_TEXT: Record<CellState['status'], string> = {
  idle: '',
  running: 'Running…',
  ok: 'Ran',
  error: 'Error',
  stale: 'Out of date: run again',
};

export default function Cell(props: CellProps) {
  const { cell, index, count, isLoad } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const labelConf = useRef(new Compartment());
  // Latest callbacks, so the editor is created once.
  const cb = useRef(props);
  cb.current = props;

  const label = `Cell ${index + 1} code${isLoad ? ' (loads the data)' : ''}`;

  useEffect(() => {
    const view = new EditorView({
      doc: cb.current.cell.code,
      parent: hostRef.current!,
      extensions: [
        Prec.highest(
          keymap.of([
            {
              key: 'Shift-Enter',
              run: () => {
                cb.current.onRun();
                return true;
              },
            },
          ]),
        ),
        basicSetup,
        python(),
        labelConf.current.of(EditorView.contentAttributes.of({ 'aria-label': label })),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) cb.current.onChange(u.state.doc.toString());
        }),
      ],
    });
    viewRef.current = view;
    if (cb.current.autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once per cell; label and code are synced below.
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: labelConf.current.reconfigure(EditorView.contentAttributes.of({ 'aria-label': label })),
    });
  }, [label]);

  // Code changed from outside the editor (load cell regenerated, Reset, …).
  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== cell.code) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: cell.code } });
    }
  }, [cell.code]);

  const out = cell.output;
  const n = index + 1;
  return (
    <div className={`nb-cell nb-cell--${cell.status}`} onFocus={props.onFocus}>
      <div className="nb-cell-bar">
        <span className="nb-cell-label">{isLoad ? 'Load data' : `Cell ${n}`}</span>
        {STATUS_TEXT[cell.status] && (
          <span className={`nb-cell-status nb-cell-status--${cell.status}`}>{STATUS_TEXT[cell.status]}</span>
        )}
        <div className="nb-cell-actions">
          <button
            type="button"
            className="nb-btn nb-btn--primary"
            onClick={props.onRun}
            disabled={props.runDisabled}
            aria-label={`Run cell ${n}`}
            title="Run (Shift+Enter)"
          >
            Run
          </button>
          {!isLoad && (
            <>
              <button
                type="button"
                className="nb-btn"
                onClick={props.onMoveUp}
                disabled={index <= 1}
                aria-label={`Move cell ${n} up`}
              >
                Move up
              </button>
              <button
                type="button"
                className="nb-btn"
                onClick={props.onMoveDown}
                disabled={index >= count - 1}
                aria-label={`Move cell ${n} down`}
              >
                Move down
              </button>
              <button type="button" className="nb-btn" onClick={props.onDelete} aria-label={`Delete cell ${n}`}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
      <div className="nb-editor" ref={hostRef} />
      {out && (
        <div className="nb-output" aria-label={`Cell ${n} output`}>
          {out.stdout && <pre className="nb-stdout">{out.stdout}</pre>}
          {out.error && (
            <div className="nb-error" role="alert">
              <p>
                <strong>
                  {out.error.name}: {out.error.message}
                </strong>
              </p>
              <details>
                <summary>Full error (traceback)</summary>
                <pre>{out.error.traceback}</pre>
              </details>
            </div>
          )}
          {out.table && <TableView table={out.table} label={`Cell ${n} table`} />}
          {out.text !== undefined && <pre className="nb-text">{out.text}</pre>}
        </div>
      )}
    </div>
  );
}
