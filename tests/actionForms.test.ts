import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MENU_ITEMS,
  emptyForm,
  allowedStrategies,
  buildAction,
  type FormState,
  effectiveForm,
  type ColumnInfo,
} from '../src/components/notebook/actionForms.ts';

const columns: ColumnInfo[] = [
  { name: 'STNAME', dtype: 'object', numeric: false, missing: 0 },
  { name: 'POP', dtype: 'int64', numeric: true, missing: 2 },
  { name: 'AREA', dtype: 'float64', numeric: true, missing: 0 },
  { name: 'EMPTY', dtype: 'float64', numeric: true, missing: 10 },
];
const ROWS = 10;
const form = (patch: Partial<FormState>): FormState => ({ ...emptyForm(), ...patch });
const build = (kind: Parameters<typeof buildAction>[0], patch: Partial<FormState>) =>
  buildAction(kind, form(patch), columns, ROWS);

test('menu lists the actions in the decided order', () => {
  assert.deepEqual(
    MENU_ITEMS.map((m) => m.label),
    [
      'Drop columns',
      'Drop rows by position',
      'Drop rows where…',
      'Drop missing values',
      'Fill missing values',
      'Rename a column',
      "Change a column's type",
      'Keep only rows where…',
      'Remove duplicate rows',
    ],
  );
});

test('dropColumns needs at least one column', () => {
  assert.equal(build('dropColumns', {}), null);
  assert.deepEqual(build('dropColumns', { columns: ['POP'] }), { kind: 'dropColumns', columns: ['POP'] });
});

test('dropRowsByPosition validates 0 <= start <= end < rows', () => {
  assert.deepEqual(build('dropRowsByPosition', { start: '0', end: '9' }), {
    kind: 'dropRowsByPosition',
    start: 0,
    end: 9,
  });
  assert.deepEqual(build('dropRowsByPosition', { start: '3', end: '3' }), {
    kind: 'dropRowsByPosition',
    start: 3,
    end: 3,
  });
  for (const [start, end] of [
    ['', '2'],
    ['2', ''],
    ['-1', '2'],
    ['4', '3'],
    ['0', '10'],
    ['1.5', '3'],
    ['a', '3'],
  ]) {
    assert.equal(build('dropRowsByPosition', { start, end }), null, `${start}-${end}`);
  }
});

test('conditions: numeric flag comes from the column and value must be a number then', () => {
  assert.deepEqual(build('filterRows', { column: 'POP', op: '>', value: '100' }), {
    kind: 'filterRows',
    condition: { column: 'POP', op: '>', value: '100', numeric: true },
  });
  assert.equal(build('filterRows', { column: 'POP', op: '>', value: 'abc' }), null);
  assert.deepEqual(build('dropRowsWhere', { column: 'STNAME', op: '==', value: 'Tennessee' }), {
    kind: 'dropRowsWhere',
    condition: { column: 'STNAME', op: '==', value: 'Tennessee', numeric: false },
  });
  // contains is always text, even on numeric columns
  assert.deepEqual(build('filterRows', { column: 'POP', op: 'contains', value: '12' }), {
    kind: 'filterRows',
    condition: { column: 'POP', op: 'contains', value: '12', numeric: false },
  });
  assert.equal(build('filterRows', { column: '', op: '==', value: 'x' }), null);
  assert.equal(build('filterRows', { column: 'STNAME', op: '==', value: '' }), null);
  assert.equal(build('filterRows', { column: 'Nope', op: '==', value: 'x' }), null);
});

test('dropMissing allows no columns (all) and passes how', () => {
  assert.deepEqual(build('dropMissing', {}), { kind: 'dropMissing', columns: [], how: 'any' });
  assert.deepEqual(build('dropMissing', { columns: ['POP', 'AREA'], how: 'all' }), {
    kind: 'dropMissing',
    columns: ['POP', 'AREA'],
    how: 'all',
  });
});

test('allowedStrategies: mean/median need all-numeric, mode needs no fully-missing column', () => {
  assert.deepEqual(allowedStrategies(['POP', 'AREA'], columns, ROWS).strategies, ['mean', 'median', 'mode', 'value']);
  assert.deepEqual(allowedStrategies(['STNAME'], columns, ROWS).strategies, ['mode', 'value']);
  assert.deepEqual(allowedStrategies(['POP', 'STNAME'], columns, ROWS).strategies, ['mode', 'value']);
  const empty = allowedStrategies(['POP', 'EMPTY'], columns, ROWS);
  assert.deepEqual(empty.strategies, ['mean', 'median', 'value']);
  assert.match(empty.modeHint ?? '', /EMPTY/);
  assert.equal(allowedStrategies(['POP'], columns, ROWS).modeHint, undefined);
  assert.deepEqual(allowedStrategies([], columns, ROWS).strategies, ['value']);
});

test('fillMissing', () => {
  assert.deepEqual(build('fillMissing', { columns: ['POP'], strategy: 'median' }), {
    kind: 'fillMissing',
    columns: ['POP'],
    strategy: 'median',
  });
  assert.equal(build('fillMissing', { columns: ['STNAME'], strategy: 'mean' }), null);
  assert.equal(build('fillMissing', { columns: ['EMPTY'], strategy: 'mode' }), null);
  assert.equal(build('fillMissing', { columns: [], strategy: 'value', fillValue: '0' }), null);
  assert.deepEqual(build('fillMissing', { columns: ['POP', 'AREA'], strategy: 'value', fillValue: '0' }), {
    kind: 'fillMissing',
    columns: ['POP', 'AREA'],
    strategy: 'value',
    value: '0',
    numeric: true,
  });
  assert.equal(build('fillMissing', { columns: ['POP'], strategy: 'value', fillValue: 'x' }), null);
  assert.equal(build('fillMissing', { columns: ['STNAME'], strategy: 'value', fillValue: '' }), null);
  assert.deepEqual(build('fillMissing', { columns: ['STNAME'], strategy: 'value', fillValue: 'Unknown' }), {
    kind: 'fillMissing',
    columns: ['STNAME'],
    strategy: 'value',
    value: 'Unknown',
    numeric: false,
  });
});

test('rename needs a new, different, unused name', () => {
  assert.deepEqual(build('rename', { column: 'POP', newName: ' Population ' }), {
    kind: 'rename',
    from: 'POP',
    to: 'Population',
  });
  assert.equal(build('rename', { column: 'POP', newName: '' }), null);
  assert.equal(build('rename', { column: 'POP', newName: '  ' }), null);
  assert.equal(build('rename', { column: 'POP', newName: 'POP' }), null);
  assert.equal(build('rename', { column: 'POP', newName: 'AREA' }), null);
  assert.equal(build('rename', { column: '', newName: 'x' }), null);
});

test('changeType and dropDuplicates', () => {
  assert.deepEqual(build('changeType', { column: 'POP', toType: 'text' }), {
    kind: 'changeType',
    column: 'POP',
    to: 'text',
  });
  assert.equal(build('changeType', { column: '', toType: 'text' }), null);
  assert.deepEqual(build('dropDuplicates', {}), { kind: 'dropDuplicates' });
});

test('a stale fill strategy falls back to value in both effectiveForm and buildAction', () => {
  const f = form({ columns: ['POP', 'STNAME'], strategy: 'median', fillValue: 'n/a' });
  assert.equal(effectiveForm(f, columns, ROWS).strategy, 'value');
  assert.deepEqual(buildAction('fillMissing', f, columns, ROWS), {
    kind: 'fillMissing',
    columns: ['POP', 'STNAME'],
    strategy: 'value',
    value: 'n/a',
    numeric: false,
  });
  assert.equal(effectiveForm(form({ columns: ['POP'], strategy: 'median' }), columns, ROWS).strategy, 'median');
});

test('names no longer in the table are ignored', () => {
  const live = columns.filter((c) => c.name !== 'POP');
  assert.deepEqual(buildAction('dropColumns', form({ columns: ['POP', 'AREA'] }), live, ROWS), {
    kind: 'dropColumns',
    columns: ['AREA'],
  });
  assert.equal(buildAction('dropColumns', form({ columns: ['POP'] }), live, ROWS), null);
  assert.equal(buildAction('filterRows', form({ column: 'POP', value: '1' }), live, ROWS), null);
  assert.equal(effectiveForm(form({ column: 'POP' }), live, ROWS).column, '');
});

test('numeric values are trimmed', () => {
  assert.deepEqual(build('filterRows', { column: 'POP', op: '>', value: ' 100 ' }), {
    kind: 'filterRows',
    condition: { column: 'POP', op: '>', value: '100', numeric: true },
  });
  assert.equal(
    (build('fillMissing', { columns: ['POP'], strategy: 'value', fillValue: ' 5 ' }) as { value: string }).value,
    '5',
  );
});
