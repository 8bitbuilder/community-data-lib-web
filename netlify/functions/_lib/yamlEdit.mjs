import { isMap, isScalar, parseDocument, stringify } from 'yaml';

// Match PyYAML's output (block lists flush with their key) and quote YAML 1.1
// lookalikes such as "yes" or "2025" so the Python pipeline reads strings back.
const BLOCK_OPTIONS = { indentSeq: false, lineWidth: 80, minContentWidth: 0, version: '1.1' };

export const readYaml = (text) => {
  const doc = parseDocument(text, { version: '1.1' });
  if (doc.errors.length > 0) {
    throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  }
  return doc.toJS();
};

/**
 * Replace the source text of each top-level key in `updates`, append keys
 * that are not present, and leave every other byte untouched. Re-serializing
 * the whole document would re-wrap long strings and turn `-181533.0` into an int.
 * Comments, blank lines, and trailing markers between edited keys are preserved.
 */
export function replaceTopLevelKeys(text, updates) {
  const doc = parseDocument(text, { version: '1.1' });
  if (doc.errors.length > 0) {
    throw new Error(`Invalid YAML: ${doc.errors[0].message}`);
  }
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
    const limit = index + 1 < pairs.length ? pairs[index + 1].key.range[0] : text.length;

    // Use line-based algorithm to handle block values correctly
    const region = text.slice(start, limit);
    const lines = region.match(/[^\n]*\n|[^\n]+$/g) || [];

    // Determine if value is a block scalar
    const isBlockScalar = isScalar(pairs[index].value) &&
      (pairs[index].value.type === 'BLOCK_LITERAL' || pairs[index].value.type === 'BLOCK_FOLDED');

    // Walk backwards to find trailing lines (comments, blank lines, document markers)
    let lastNonTrailingIdx = 0;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      const trimmed = line.trim();
      const isBlank = trimmed === '';
      const isMarker = trimmed === '...' || trimmed === '---';
      const isComment = trimmed.startsWith('#');

      if (isBlank || isMarker) {
        // Trailing
        continue;
      }

      if (isComment) {
        // Comment is trailing if: value is not a block scalar OR line has zero indentation
        const leadingSpaces = line.match(/^(\s*)/)[1].length;
        const isZeroIndent = leadingSpaces === 0;
        if (!isBlockScalar || isZeroIndent) {
          // Trailing
          continue;
        }
      }

      // First non-trailing line found
      lastNonTrailingIdx = i;
      break;
    }

    // Calculate end position: sum of lengths of lines up to and including lastNonTrailingIdx
    let end = start;
    for (let i = 0; i <= lastNonTrailingIdx && i < lines.length; i++) {
      end += lines[i].length;
    }

    edits.push([start, end, block]);
  }

  let out = text;
  for (const [start, end, block] of edits.sort((a, b) => b[0] - a[0])) {
    out = out.slice(0, start) + block + out.slice(end);
  }
  if (appended) out = (out === '' || out.endsWith('\n') ? out : `${out}\n`) + appended;
  return out;
}
