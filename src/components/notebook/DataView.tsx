import type { DfInfo } from './usePyodide';

export interface TableData {
  columns: string[];
  rows: string[][];
}

/**
 * A pandas table. The first `indexCols` columns are the row index (the worker
 * already includes them). `missing` holds one count per data column and is shown
 * as an extra header row aligned under the data columns.
 */
export function TableView({
  table,
  label,
  missing,
}: {
  table: TableData;
  label: string;
  missing?: number[];
}) {
  const indexCols = missing ? Math.max(0, table.columns.length - missing.length) : Math.min(1, table.columns.length);
  return (
    <div className="nb-table-scroll" role="region" aria-label={label} tabIndex={0}>
      <table className="nb-table">
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={i} scope="col" className={i < indexCols ? 'nb-index' : undefined}>
                {c}
              </th>
            ))}
          </tr>
          {missing && (
            <tr className="nb-missing-row">
              {Array.from({ length: indexCols }, (_, i) => (
                <td key={`i${i}`} className="nb-index" />
              ))}
              {missing.map((n, i) => (
                <td key={i} className={n > 0 ? 'nb-has-missing' : undefined}>
                  missing: {n}
                </td>
              ))}
            </tr>
          )}
        </thead>
        <tbody>
          {table.rows.map((row, r) => (
            <tr key={r}>
              {row.map((v, i) =>
                i < indexCols ? (
                  <th key={i} scope="row" className="nb-index">
                    {v}
                  </th>
                ) : (
                  <td key={i}>{v}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The live view of `df` shown under the toolbar. `undefined` = nothing has run yet. */
export default function DataView({ info }: { info: DfInfo | null | undefined }) {
  if (info === undefined) return null;
  return (
    <div className="nb-dataview">
      <h3 className="nb-subtitle">Your data (df)</h3>
      {info === null ? (
        <p className="nb-muted" aria-live="polite">
          df isn&apos;t a table right now.
        </p>
      ) : (
        <>
          <p className="nb-shape" aria-live="polite">
            {info.rows.toLocaleString()} rows × {info.cols.toLocaleString()} columns
          </p>
          <TableView
            table={info.head}
            label="First rows of df"
            missing={info.columns.map((c) => c.missing)}
          />
          {info.rows > info.head.rows.length && (
            <p className="nb-muted">Showing the first {info.head.rows.length} rows.</p>
          )}
        </>
      )}
    </div>
  );
}
