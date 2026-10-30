// "+ Cleaning step" menu: each choice opens a small form that builds a CleaningAction,
// whose commented pandas code is inserted and run as a visible notebook cell.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { actionCell } from './codegen';
import {
  MENU_ITEMS,
  OPS,
  allowedStrategies,
  buildAction,
  emptyForm,
  type ActionKind,
  type ColumnInfo,
  type FormState,
  type Strategy,
} from './actionForms';

interface Props {
  columns: ColumnInfo[];
  rows: number;
  disabled: boolean;
  onInsert: (code: string) => void;
}

const STRATEGY_LABEL: Record<Strategy, string> = {
  mean: 'Average (mean)',
  median: 'Middle value (median)',
  mode: 'Most common value',
  value: 'A value I type',
};

export default function ActionMenu({ columns, rows, disabled, onInsert }: Props) {
  const uid = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ActionKind | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));
  const close = (refocus: boolean) => {
    setOpen(false);
    setKind(null);
    if (refocus) buttonRef.current?.focus();
  };

  // Disabling the menu (data unloaded, Run all) closes any open form.
  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setKind(null);
    }
  }, [disabled]);

  // Focus the first field (or the first menu item) when something opens.
  useEffect(() => {
    const target = kind
      ? rootRef.current?.querySelector<HTMLElement>('.nb-action-form input, .nb-action-form select')
      : open
        ? rootRef.current?.querySelector<HTMLElement>('.nb-action-list button')
        : null;
    target?.focus();
  }, [open, kind]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && (open || kind)) {
      e.stopPropagation();
      close(true);
    }
  };

  const choose = (k: ActionKind) => {
    setForm(emptyForm());
    setOpen(false);
    setKind(k);
  };

  const action = kind ? buildAction(kind, form, columns, rows) : null;
  const submit = () => {
    if (!action) return;
    onInsert(actionCell(action));
    close(true);
  };

  const columnSelect = (label: string) => (
    <label className="nb-field">
      {label}
      <select value={form.column} onChange={(e) => patch({ column: e.target.value })}>
        <option value="">Choose a column…</option>
        {columns.map((c) => (
          <option key={c.name} value={c.name}>
            {c.name}
          </option>
        ))}
      </select>
    </label>
  );

  const columnChecks = (legend: string, hint?: string) => (
    <fieldset className="nb-checks">
      <legend>{legend}</legend>
      {hint && <p className="nb-hint">{hint}</p>}
      <div className="nb-check-list">
        {columns.map((c) => (
          <label key={c.name} className="nb-check">
            <input
              type="checkbox"
              checked={form.columns.includes(c.name)}
              onChange={(e) =>
                patch({
                  columns: e.target.checked
                    ? columns.map((x) => x.name).filter((n) => n === c.name || form.columns.includes(n))
                    : form.columns.filter((n) => n !== c.name),
                })
              }
            />
            {c.name}
          </label>
        ))}
      </div>
    </fieldset>
  );

  const conditionFields = () => {
    const col = columns.find((c) => c.name === form.column);
    const numericValue = !!col?.numeric && form.op !== 'contains';
    return (
      <>
        {columnSelect('Column')}
        <label className="nb-field">
          Test
          <select value={form.op} onChange={(e) => patch({ op: e.target.value as FormState['op'] })}>
            {OPS.map((o) => (
              <option key={o.op} value={o.op}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="nb-field">
          Value
          <input
            type="text"
            inputMode={numericValue ? 'decimal' : undefined}
            value={form.value}
            onChange={(e) => patch({ value: e.target.value })}
          />
        </label>
        {numericValue && <p className="nb-hint">This column holds numbers, so type a number.</p>}
      </>
    );
  };

  const strat = allowedStrategies(form.columns, columns, rows);
  const strategy = strat.strategies.includes(form.strategy) ? form.strategy : 'value';
  const fillNumeric = form.columns.length > 0 && form.columns.every((n) => columns.find((c) => c.name === n)?.numeric);

  const fields = () => {
    switch (kind) {
      case 'dropColumns':
        return columnChecks('Columns to drop');
      case 'dropRowsByPosition':
        return (
          <>
            <p className="nb-hint">
              Rows are counted from 0 (the first row is 0). This table has {rows} {rows === 1 ? 'row' : 'rows'}, so
              positions go from 0 to {Math.max(rows - 1, 0)}.
            </p>
            <label className="nb-field">
              First row to drop
              <input type="text" inputMode="numeric" value={form.start} onChange={(e) => patch({ start: e.target.value })} />
            </label>
            <label className="nb-field">
              Last row to drop
              <input type="text" inputMode="numeric" value={form.end} onChange={(e) => patch({ end: e.target.value })} />
            </label>
          </>
        );
      case 'dropRowsWhere':
      case 'filterRows':
        return conditionFields();
      case 'dropMissing':
        return (
          <>
            {columnChecks('Look at these columns (leave all unchecked to look at every column)')}
            <label className="nb-field">
              Drop a row when
              <select value={form.how} onChange={(e) => patch({ how: e.target.value as 'any' | 'all' })}>
                <option value="any">any value is missing</option>
                <option value="all">every value is missing</option>
              </select>
            </label>
          </>
        );
      case 'fillMissing':
        return (
          <>
            {columnChecks('Columns to fill')}
            <label className="nb-field">
              Fill with
              <select value={strategy} onChange={(e) => patch({ strategy: e.target.value as Strategy })}>
                {strat.strategies.map((s) => (
                  <option key={s} value={s}>
                    {STRATEGY_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            {form.columns.length > 0 && !fillNumeric && (
              <p className="nb-hint">Average and middle value are only offered when every chosen column holds numbers.</p>
            )}
            {strat.modeHint && <p className="nb-hint">{strat.modeHint}</p>}
            {strategy === 'value' && (
              <label className="nb-field">
                Value
                <input
                  type="text"
                  inputMode={fillNumeric ? 'decimal' : undefined}
                  value={form.fillValue}
                  onChange={(e) => patch({ fillValue: e.target.value })}
                />
              </label>
            )}
          </>
        );
      case 'rename':
        return (
          <>
            {columnSelect('Column to rename')}
            <label className="nb-field">
              New name
              <input type="text" value={form.newName} onChange={(e) => patch({ newName: e.target.value })} />
            </label>
            {form.newName.trim() !== '' && columns.some((c) => c.name === form.newName.trim()) && (
              <p className="nb-hint">A column with that name already exists.</p>
            )}
          </>
        );
      case 'changeType':
        return (
          <>
            {columnSelect('Column')}
            <label className="nb-field">
              Change to
              <select value={form.toType} onChange={(e) => patch({ toType: e.target.value as FormState['toType'] })}>
                <option value="number">Numbers</option>
                <option value="text">Text</option>
                <option value="date">Dates</option>
              </select>
            </label>
          </>
        );
      case 'dropDuplicates':
        return <p className="nb-hint">Rows that are exact copies of an earlier row will be removed.</p>;
      default:
        return null;
    }
  };

  const title = MENU_ITEMS.find((m) => m.kind === kind)?.label;

  return (
    <div className="nb-actions" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="nb-btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={`${uid}-list`}
        disabled={disabled}
        title={disabled ? 'Load the data first' : undefined}
        onClick={() => {
          setKind(null);
          setOpen((o) => !o);
        }}
      >
        + Cleaning step ▾
      </button>
      {open && (
        <ul className="nb-action-list" id={`${uid}-list`}>
          {MENU_ITEMS.map((m) => (
            <li key={m.kind}>
              <button type="button" className="nb-action-item" onClick={() => choose(m.kind)}>
                {m.label}
              </button>
            </li>
          ))}
        </ul>
      )}
      {kind && (
        <form
          className="nb-action-form"
          aria-label={title}
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <h3 className="nb-action-title">{title}</h3>
          {fields()}
          <div className="nb-prompt-actions">
            <button type="submit" className="nb-btn nb-btn--primary" disabled={!action}>
              Add step
            </button>
            <button type="button" className="nb-btn" onClick={() => close(true)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
