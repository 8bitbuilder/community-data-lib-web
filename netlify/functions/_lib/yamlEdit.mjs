import { isMap, parseDocument, stringify } from 'yaml';

// Match PyYAML's output (block lists flush with their key) and quote YAML 1.1
// lookalikes such as "yes" or "2025" so the Python pipeline reads strings back.
const BLOCK_OPTIONS = { indentSeq: false, lineWidth: 80, minContentWidth: 0, version: '1.1' };

export const readYaml = (text) => parseDocument(text, { version: '1.1' }).toJS();

/**
 * Replace the source text of each top-level key in `updates`, append keys
 * that are not present, and leave every other byte untouched. Re-serializing
 * the whole document would re-wrap long strings and turn `-181533.0` into an int.
 */
export function replaceTopLevelKeys(text, updates) {
  const doc = parseDocument(text, { version: '1.1' });
  if (!isMap(doc.contents)) throw new Error('YAML root must be a mapping');
  const pairs = doc.contents.items;
  const edits = [];
  let appended = '';

  for (const [key, value] of Object.entries(updates)) {
    const block = stringify({ [key]: value }, BLOCK_OPTIONS);
    const index = pairs.findIndex((pair) => pair.key?.value === key);
    if (index === -1) {
      appended += block;
      continue;
    }
    const start = pairs[index].key.range[0];
    const end = index + 1 < pairs.length ? pairs[index + 1].key.range[0] : text.length;
    edits.push([start, end, block]);
  }

  let out = text;
  for (const [start, end, block] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + block + out.slice(end);
  }
  if (appended) out = (out === '' || out.endsWith('\n') ? out : `${out}\n`) + appended;
  return out;
}
