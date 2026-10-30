import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settleReply,
  safeFileName,
  type PendingEntry,
  type PendingKind,
} from '../src/components/notebook/pyodideProtocol.ts';

function setup(kind: PendingKind) {
  const pending = new Map<number, PendingEntry>();
  const log: { ok?: unknown; err?: string } = {};
  pending.set(1, {
    kind,
    resolve: (v) => (log.ok = v),
    reject: (e) => (log.err = e.message),
  });
  return { pending, log };
}

test('error reply rejects export and writeFile', () => {
  for (const kind of ['export', 'writeFile'] as const) {
    const { pending, log } = setup(kind);
    settleReply(pending, { type: 'error', id: 1, message: 'boom' });
    assert.equal(log.err, 'boom');
    assert.equal(pending.size, 0);
  }
});

test('file resolves export, done resolves writeFile, result resolves run', () => {
  let s = setup('export');
  const bytes = new Uint8Array([1]);
  settleReply(s.pending, { type: 'file', id: 1, bytes });
  assert.equal(s.log.ok, bytes);
  s = setup('writeFile');
  settleReply(s.pending, { type: 'done', id: 1 });
  assert.equal(s.log.ok, undefined);
  assert.equal(s.log.err, undefined);
  s = setup('run');
  settleReply(s.pending, { type: 'result', id: 1, output: { stdout: '' }, dfInfo: null });
  assert.deepEqual(s.log.ok, { output: { stdout: '' }, dfInfo: null });
});

test('mismatched reply kind rejects rather than resolving wrongly', () => {
  const { pending, log } = setup('export');
  settleReply(pending, { type: 'result', id: 1, output: { stdout: '' }, dfInfo: null });
  assert.match(log.err ?? '', /Unexpected/);
});

test('unknown id is ignored', () => {
  const { pending, log } = setup('run');
  settleReply(pending, { type: 'done', id: 9 });
  assert.equal(pending.size, 1);
  assert.equal(log.ok, undefined);
});

test('safeFileName keeps basename and rejects empty or dot names', () => {
  assert.equal(safeFileName('a/b/c.xlsx'), 'c.xlsx');
  assert.equal(safeFileName('..\\x.xls'), 'x.xls');
  assert.equal(safeFileName(''), null);
  assert.equal(safeFileName('..'), null);
  assert.equal(safeFileName('dir/'), null);
});
