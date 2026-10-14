import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readYaml, replaceTopLevelKeys } from './yamlEdit.mjs';

const SRC = readFileSync(new URL('./fixtures/sample-source.yml', import.meta.url), 'utf8');

function changedLines(a, b) {
  const x = a.split('\n');
  const y = b.split('\n');
  const out = [];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if (x[i] !== y[i]) out.push(i);
  return out;
}

test('no updates leaves the file byte-identical', () => {
  assert.equal(replaceTopLevelKeys(SRC, {}), SRC);
});

test('replacing title changes exactly one line', () => {
  const out = replaceTopLevelKeys(SRC, { title: 'New Title' });
  assert.equal(readYaml(out).title, 'New Title');
  assert.equal(changedLines(SRC, out).length, 1);
});

test('untouched values keep their exact source text (floats, long strings)', () => {
  const out = replaceTopLevelKeys(SRC, { title: 'New Title' });
  assert.ok(SRC.includes('min: -181533.0'));
  assert.ok(out.includes('min: -181533.0'));
  const before = readYaml(SRC);
  const after = readYaml(out);
  for (const key of Object.keys(before)) if (key !== 'title') assert.deepEqual(after[key], before[key], key);
});

test('lists are written in PyYAML style (no extra indent)', () => {
  const out = replaceTopLevelKeys(SRC, { description_tags: ['Agriculture', 'Population Data'] });
  assert.match(out, /\ndescription_tags:\n- Agriculture\n- Population Data\n/);
});

test('missing keys are appended at the end', () => {
  const out = replaceTopLevelKeys(SRC, { manual_tags: ['description_tags'] });
  assert.ok(out.startsWith(SRC.endsWith('\n') ? SRC : `${SRC}\n`));
  assert.ok(out.endsWith('manual_tags:\n- description_tags\n'));
});

test('YAML 1.1 lookalikes are quoted so PyYAML keeps them as strings', () => {
  for (const value of ['yes', 'No', 'on', 'off', '2025', 'null', '~', '0777', '1.0']) {
    const out = replaceTopLevelKeys('title: x\n', { title: value });
    assert.match(out, /^title: (".*"|'.*')\n$/, `${value} should be quoted, got ${out}`);
    assert.equal(readYaml(out).title, value);
  }
});

test('non-mapping roots are rejected', () => {
  assert.throws(() => replaceTopLevelKeys('- a\n- b\n', { title: 'x' }), /mapping/);
});
