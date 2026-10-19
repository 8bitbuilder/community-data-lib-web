import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readYaml, replaceTopLevelKeys } from './yamlEdit.mjs';
import { stringify } from 'yaml';

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
  const changed = changedLines(SRC, out);
  assert.equal(changed.length, 1);
  // Line count should be unchanged
  assert.equal(SRC.split('\n').length, out.split('\n').length);
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

test('editing variable_types_tags in fixture with exact check', () => {
  // Read the current value and flip one boolean
  const currentValue = readYaml(SRC).variable_types_tags;
  const newValue = { ...currentValue, 'all-discrete': !currentValue['all-discrete'] };

  // Find the exact boundaries of variable_types_tags in SRC
  const startMarker = '\nvariable_types_tags:';
  const endMarker = '\n\n# Canonical geography';
  const startIdx = SRC.indexOf(startMarker) + 1; // +1 to skip the newline
  const endIdx = SRC.indexOf(endMarker) + 1; // +1 to include the newline before the comment

  // Build expected output by replacing the exact region
  const block = stringify({ variable_types_tags: newValue }, { indentSeq: false, lineWidth: 80, minContentWidth: 0, version: '1.1' });
  const expected = SRC.slice(0, startIdx) + block + SRC.slice(endIdx);

  // Perform the replacement
  const out = replaceTopLevelKeys(SRC, { variable_types_tags: newValue });

  // Exact check
  assert.equal(out, expected);
});

test('comments between keys are preserved on same line edit', () => {
  const yaml = 'a: 1\n# note about b\n\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 9 });
  assert.equal(out, 'a: 9\n# note about b\n\nb: 2\n');
});

test('trailing comment on same key is preserved', () => {
  const yaml1 = 'b: 2\n# end\n';
  const out1 = replaceTopLevelKeys(yaml1, { b: 9 });
  assert.equal(out1, 'b: 9\n# end\n');

  const yaml2 = 'b: 2\n...\n';
  const out2 = replaceTopLevelKeys(yaml2, { b: 9 });
  assert.equal(out2, 'b: 9\n...\n');
});

test('two edits in one call', () => {
  const yaml = 'a: 1\nb: 2\nc: 3\n';
  const out = replaceTopLevelKeys(yaml, { a: 10, c: 30 });
  assert.equal(out, 'a: 10\nb: 2\nc: 30\n');
});

test('invalid YAML with duplicate keys is rejected by readYaml', () => {
  assert.throws(
    () => readYaml('a: 1\nb: 2\na: 3\n'),
    /Invalid YAML/
  );
});

test('invalid YAML with duplicate keys is rejected by replaceTopLevelKeys', () => {
  assert.throws(
    () => replaceTopLevelKeys('a: 1\nb: 2\na: 3\n', { a: 9 }),
    /Invalid YAML/
  );
});

test('block sequence: edits preserve following keys', () => {
  const yaml = 'a: 1\nlist:\n- x\n- y\nc: 3\n';
  const out = replaceTopLevelKeys(yaml, { c: 7, list: ['z'] });
  assert.equal(out, 'a: 1\nlist:\n- z\nc: 7\n');
});

test('nested map: comments are preserved', () => {
  const yaml = 'a:\n  x: 1\n  y: 2\n# cm\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 9 });
  assert.equal(out, 'a: 9\n# cm\nb: 2\n');
});

test('nested map with internal comment: trailing comment preserved', () => {
  const yaml = 'a:\n  x: 1\n  # in\n  y: 2\n  # tail\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 9 });
  assert.equal(out, 'a: 9\n  # tail\nb: 2\n');
});

test('block literal scalar: following keys preserved', () => {
  const yaml = 'a: |\n  x\n  y\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 'q' });
  assert.equal(out, 'a: q\nb: 2\n');
});

test('block literal with trailing comment: comment preserved', () => {
  const yaml = 'a: |\n  x\n  y\n\n# c\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 'q' });
  assert.equal(out, 'a: q\n\n# c\nb: 2\n');
});

test('block literal with indented hash: hash is content', () => {
  const yaml = 'a: |\n  x\n  # y\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 'q' });
  assert.equal(out, 'a: q\nb: 2\n');
});

test('null value on same line as key', () => {
  const yaml = 'a:\nb: 2\n';
  const out = replaceTopLevelKeys(yaml, { a: 1 });
  assert.equal(out, 'a: 1\nb: 2\n');
});
