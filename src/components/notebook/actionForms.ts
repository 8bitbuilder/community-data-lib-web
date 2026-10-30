// Pure form-state -> CleaningAction logic for the guided cleaning menu.
// No DOM, no runtime imports.
import type { CleaningAction, Condition, Op } from './codegen';
import type { DfInfo } from './usePyodide';

export type ColumnInfo = DfInfo['columns'][number];
export type ActionKind = CleaningAction['kind'];
export type Strategy = 'mean' | 'median' | 'mode' | 'value';

export const MENU_ITEMS: { kind: ActionKind; label: string }[] = [
  { kind: 'dropColumns', label: 'Drop columns' },
  { kind: 'dropRowsByPosition', label: 'Drop rows by position' },
  { kind: 'dropRowsWhere', label: 'Drop rows where…' },
  { kind: 'dropMissing', label: 'Drop missing values' },
  { kind: 'fillMissing', label: 'Fill missing values' },
  { kind: 'rename', label: 'Rename a column' },
  { kind: 'changeType', label: "Change a column's type" },
  { kind: 'filterRows', label: 'Keep only rows where…' },
  { kind: 'dropDuplicates', label: 'Remove duplicate rows' },
];

export const OPS: { op: Op; label: string }[] = [
  { op: '==', label: 'is equal to' },
  { op: '!=', label: 'is not equal to' },
  { op: '>', label: 'is greater than' },
  { op: '>=', label: 'is at least' },
  { op: '<', label: 'is less than' },
  { op: '<=', label: 'is at most' },
  { op: 'contains', label: 'contains' },
];

export interface FormState {
  columns: string[];
  column: string;
  start: string;
  end: string;
  op: Op;
  value: string;
  how: 'any' | 'all';
  strategy: Strategy;
  fillValue: string;
  newName: string;
  toType: 'number' | 'text' | 'date';
}

export function emptyForm(): FormState {
  return {
    columns: [],
    column: '',
    start: '',
    end: '',
    op: '==',
    value: '',
    how: 'any',
    strategy: 'value',
    fillValue: '',
    newName: '',
    toType: 'number',
  };
}

const PLAIN_DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
export const isNumber = (s: string) => PLAIN_DECIMAL.test(s.trim()) && Number.isFinite(Number(s.trim()));

function find(columns: ColumnInfo[], name: string): ColumnInfo | undefined {
  return columns.find((c) => c.name === name);
}

/** Fill strategies that are safe for the chosen columns, plus why mode may be missing. */
export function allowedStrategies(
  chosen: string[],
  columns: ColumnInfo[],
  rows: number,
): { strategies: Strategy[]; modeHint?: string } {
  const infos = chosen.map((n) => find(columns, n)).filter((c): c is ColumnInfo => !!c);
  const strategies: Strategy[] = [];
  const allNumeric = infos.length > 0 && infos.every((c) => c.numeric);
  const empty = infos.filter((c) => c.missing === rows);
  if (allNumeric) strategies.push('mean', 'median');
  let modeHint: string | undefined;
  if (infos.length > 0) {
    if (empty.length === 0) strategies.push('mode');
    else modeHint = `Most common value isn't available: ${empty.map((c) => c.name).join(', ')} has no values at all.`;
  }
  strategies.push('value');
  return { strategies, modeHint };
}

/** Whether a condition on the chosen column compares numbers (contains is always text). */
export function conditionIsNumeric(f: FormState, columns: ColumnInfo[]): boolean {
  return !!find(columns, f.column)?.numeric && f.op !== 'contains';
}

/** Whether every chosen column holds numbers. */
export function allChosenNumeric(chosen: string[], columns: ColumnInfo[]): boolean {
  return chosen.length > 0 && chosen.every((n) => find(columns, n)?.numeric);
}

/**
 * The form as it applies to the current columns: selections that no longer exist
 * are dropped and a fill strategy that is no longer allowed falls back to 'value'.
 * Used by both the UI and buildAction so they cannot disagree.
 */
export function effectiveForm(f: FormState, columns: ColumnInfo[], rows: number): FormState {
  const chosen = f.columns.filter((n) => find(columns, n));
  const strategy = allowedStrategies(chosen, columns, rows).strategies.includes(f.strategy)
    ? f.strategy
    : 'value';
  return { ...f, columns: chosen, column: find(columns, f.column) ? f.column : '', strategy };
}

function condition(f: FormState, columns: ColumnInfo[]): Condition | null {
  const col = find(columns, f.column);
  if (!col || f.value === '') return null;
  const numeric = conditionIsNumeric(f, columns);
  if (numeric && !isNumber(f.value)) return null;
  return { column: f.column, op: f.op, value: numeric ? f.value.trim() : f.value, numeric };
}

const WHOLE = /^\d+$/;

/** The action for the current form, or null while the form is not valid. */
export function buildAction(
  kind: ActionKind,
  raw: FormState,
  columns: ColumnInfo[],
  rows: number,
): CleaningAction | null {
  const f = effectiveForm(raw, columns, rows);
  switch (kind) {
    case 'dropColumns':
      return f.columns.length > 0 ? { kind, columns: f.columns } : null;
    case 'dropRowsByPosition': {
      if (!WHOLE.test(f.start.trim()) || !WHOLE.test(f.end.trim())) return null;
      const start = Number(f.start);
      const end = Number(f.end);
      return start <= end && end < rows ? { kind, start, end } : null;
    }
    case 'dropRowsWhere':
    case 'filterRows': {
      const c = condition(f, columns);
      return c ? { kind, condition: c } : null;
    }
    case 'dropMissing':
      return { kind, columns: f.columns, how: f.how };
    case 'fillMissing': {
      if (f.columns.length === 0) return null;
      if (f.strategy !== 'value') return { kind, columns: f.columns, strategy: f.strategy };
      const numeric = allChosenNumeric(f.columns, columns);
      if (f.fillValue === '' || (numeric && !isNumber(f.fillValue))) return null;
      return {
        kind,
        columns: f.columns,
        strategy: 'value',
        value: numeric ? f.fillValue.trim() : f.fillValue,
        numeric,
      };
    }
    case 'rename': {
      const to = f.newName.trim();
      if (!find(columns, f.column) || to === '' || find(columns, to)) return null;
      return { kind, from: f.column, to };
    }
    case 'changeType':
      return find(columns, f.column) ? { kind, column: f.column, to: f.toType } : null;
    case 'dropDuplicates':
      return { kind };
  }
}
