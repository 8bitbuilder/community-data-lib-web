import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  storageKey,
  loadSavedCode,
  saveCode,
  clearSaved,
  restoreCells,
  markStaleFrom,
  newCell,
  type CellState,
} from '../src/components/notebook/notebookStore.ts';

const realLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

function stubStorage(store: Record<string, string> | 'throws') {
  const impl =
    store === 'throws'
      ? {
          getItem: () => {
            throw new Error('denied');
          },
          setItem: () => {
            throw new Error('denied');
          },
          removeItem: () => {
            throw new Error('denied');
          },
        }
      : {
          getItem: (k: string) => (k in store ? store[k] : null),
          setItem: (k: string, v: string) => {
            store[k] = String(v);
          },
          removeItem: (k: string) => {
            delete store[k];
          },
        };
  Object.defineProperty(globalThis, 'localStorage', { value: impl, configurable: true, writable: true });
  return impl;
}

afterEach(() => {
  if (realLocalStorage) Object.defineProperty(globalThis, 'localStorage', realLocalStorage);
  else delete (globalThis as { localStorage?: unknown }).localStorage;
});

const cell = (code: string, status: CellState['status'] = 'idle'): CellState => ({
  id: newCell(code).id,
  code,
  status,
});

test('storageKey is versioned per source', () => {
  assert.equal(storageKey('abc'), 'cdl-notebook:v1:abc');
});

test('restore replaces the load cell', () => {
  const cells = restoreCells('NEW', ['x']);
  assert.equal(cells[0].code, 'NEW');
  assert.equal(cells[0].status, 'idle');
  assert.equal(cells.length, 2);
  assert.equal(cells[1].code, 'x');
  assert.equal(cells[1].status, 'idle');
  assert.notEqual(cells[0].id, cells[1].id);
});

test('restore with no saved code returns only the load cell', () => {
  const cells = restoreCells('LOAD', null);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].code, 'LOAD');
});

test('save/load round-trip stores only cells after the load cell', () => {
  const store: Record<string, string> = {};
  stubStorage(store);
  saveCode('src1', [cell('LOAD', 'ok'), cell('df.head()', 'ok'), cell('x = 1')]);
  assert.deepEqual(JSON.parse(store[storageKey('src1')]), ['df.head()', 'x = 1']);
  assert.deepEqual(loadSavedCode('src1'), ['df.head()', 'x = 1']);
});

test('saved array never contains the load cell', () => {
  const store: Record<string, string> = {};
  stubStorage(store);
  saveCode('src2', [cell('LOAD')]);
  assert.deepEqual(loadSavedCode('src2'), []);
});

test('clearSaved removes the saved notebook', () => {
  const store: Record<string, string> = {};
  stubStorage(store);
  saveCode('src3', [cell('LOAD'), cell('y')]);
  clearSaved('src3');
  assert.equal(loadSavedCode('src3'), null);
});

test('missing, corrupt or wrong-shape storage loads as null', () => {
  stubStorage({
    [storageKey('bad-json')]: '{not json',
    [storageKey('bad-shape')]: JSON.stringify({ code: 'x' }),
    [storageKey('bad-items')]: JSON.stringify(['ok', 3]),
  });
  assert.equal(loadSavedCode('missing'), null);
  assert.equal(loadSavedCode('bad-json'), null);
  assert.equal(loadSavedCode('bad-shape'), null);
  assert.equal(loadSavedCode('bad-items'), null);
});

test('storage that throws returns null and does not throw', () => {
  stubStorage('throws');
  assert.equal(loadSavedCode('src4'), null);
  assert.doesNotThrow(() => saveCode('src4', [cell('LOAD'), cell('z')]));
  assert.doesNotThrow(() => clearSaved('src4'));
});

test('missing localStorage global does not throw', () => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
  assert.equal(loadSavedCode('src5'), null);
  assert.doesNotThrow(() => saveCode('src5', [cell('LOAD'), cell('z')]));
  assert.doesNotThrow(() => clearSaved('src5'));
});

test('markStaleFrom only marks cells that already ran', () => {
  const cells = [
    cell('LOAD', 'ok'),
    cell('a', 'ok'),
    cell('b', 'error'),
    cell('c', 'idle'),
    cell('d', 'stale'),
    cell('e', 'running'),
  ];
  const before = JSON.stringify(cells);
  const out = markStaleFrom(cells, 0);
  assert.equal(JSON.stringify(cells), before, 'input must not be mutated');
  assert.notEqual(out, cells);
  assert.deepEqual(
    out.map((c) => c.status),
    ['ok', 'stale', 'stale', 'idle', 'stale', 'running'],
  );
  assert.equal(out[1].code, 'a');
  assert.equal(out[1].id, cells[1].id);
});

test('markStaleFrom leaves cells at or before index untouched', () => {
  const cells = [cell('LOAD', 'ok'), cell('a', 'ok'), cell('b', 'ok')];
  const out = markStaleFrom(cells, 1);
  assert.equal(out[0].status, 'ok');
  assert.equal(out[1].status, 'ok');
  assert.equal(out[2].status, 'stale');
});

test('newCell gives unique ids and defaults', () => {
  const a = newCell();
  const b = newCell('print(1)');
  assert.equal(a.code, '');
  assert.equal(a.status, 'idle');
  assert.equal(b.code, 'print(1)');
  assert.notEqual(a.id, b.id);
  assert.notEqual(newCell().id, newCell().id);
});
