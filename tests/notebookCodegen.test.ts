import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  pyStr,
  loadCell,
  actionCell,
  toIpynb,
  type ReadSpec,
  type Condition,
} from '../src/components/notebook/codegen.ts';

const csv: ReadSpec = { format: 'csv' };
const L = (...lines: string[]) => lines.join('\n');
const HEAD = '# Load the dataset into a table called df';
const COLS = [
  '# Make every column name text (Excel stores headers like 2020 as numbers)',
  'df.columns = df.columns.astype(str)',
];
const UA = '# Some data providers block Python\'s default User-Agent, so identify as a browser.';
const cond = (column: string, op: Condition['op'], value: string, numeric: boolean): Condition => ({
  column,
  op,
  value,
  numeric,
});

function latin1TsvZip() {
  return loadCell(
    { kind: 'zip', url: 'https://x.gov/a.zip', innerName: 'inner.csv' },
    { format: 'tsv', encoding: 'latin-1' },
  );
}

test('pyStr escapes quotes, backslashes and control characters, keeps Unicode', () => {
  assert.equal(pyStr('a "b"\\c\n'), '"a \\"b\\"\\\\c\\n"');
  assert.equal(pyStr('Ñandú – 東京'), '"Ñandú – 東京"');
  assert.equal(pyStr('a\rb\tc'), '"a\\rb\\tc"');
  assert.equal(pyStr('x\u0000y\u001fz\u007f'), '"x\\x00y\\x1fz\\x7f"');
});

test('CSV load cell for the in-browser file', () => {
  assert.equal(
    loadCell({ kind: 'file', filename: 'co-est2025-alldata.csv' }, csv),
    L(HEAD, 'import pandas as pd', '', 'df = pd.read_csv("co-est2025-alldata.csv")'),
  );
});

test('latin-1 and tsv add read_csv arguments', () => {
  const src = { kind: 'file', filename: 'a.csv' } as const;
  assert.match(loadCell(src, { format: 'csv', encoding: 'latin-1' }), /df = pd\.read_csv\("a\.csv", encoding="latin-1"\)$/);
  assert.match(loadCell(src, { format: 'tsv' }), /df = pd\.read_csv\("a\.csv", sep="\\t"\)$/);
  assert.match(
    loadCell(src, { format: 'tsv', encoding: 'latin-1' }),
    /df = pd\.read_csv\("a\.csv", encoding="latin-1", sep="\\t"\)$/,
  );
  assert.match(
    loadCell({ kind: 'url', url: 'https://x/a.tsv' }, { format: 'tsv', encoding: 'latin-1' }),
    /df = pd\.read_csv\(url, encoding="latin-1", sep="\\t", storage_options=\{"User-Agent": "Mozilla\/5\.0"\}\)$/,
  );
  assert.match(latin1TsvZip(), /df = pd\.read_csv\(archive\.open\("inner\.csv"\), encoding="latin-1", sep="\\t"\)$/);
});

test('CSV and TSV load cells do not get the column-name lines', () => {
  assert.doesNotMatch(loadCell({ kind: 'file', filename: 'a.csv' }, csv), /astype\(str\)/);
});

test('Excel load cell with sheet, header row and trimmed rows', () => {
  assert.equal(
    loadCell(
      { kind: 'file', filename: 'file.xlsx' },
      { format: 'xlsx', sheet: 'Data', headerRow: 4, dataRowCount: 52, trimmedRows: 3 },
    ),
    L(
      HEAD,
      'import pandas as pd',
      '',
      '# Read the "Data" sheet. The column names are on row 4, so skip the 3 rows above them.',
      '# nrows=52 stops before the notes at the bottom of the sheet.',
      'df = pd.read_excel("file.xlsx", sheet_name="Data", skiprows=3, nrows=52)',
      ...COLS,
    ),
  );
});

test('Excel header row 1, no trimmed rows, numeric sheet', () => {
  const out = loadCell(
    { kind: 'file', filename: 'file.xls' },
    { format: 'xls', sheet: 'Data', headerRow: 1, dataRowCount: 52, trimmedRows: 0 },
  );
  assert.equal(
    out,
    L(HEAD, 'import pandas as pd', '', '# Read the "Data" sheet.', 'df = pd.read_excel("file.xls", sheet_name="Data")', ...COLS),
  );
  const numeric = loadCell({ kind: 'file', filename: 'f.xlsx' }, { format: 'xlsx', sheet: 1, headerRow: 1 });
  assert.match(numeric, /df = pd\.read_excel\("f\.xlsx", sheet_name=1\)\n# Make every/);
  assert.doesNotMatch(numeric, /skiprows|nrows/);
});

test('Excel export from a url', () => {
  assert.equal(
    loadCell(
      { kind: 'url', url: 'https://x.gov/a.xlsx' },
      { format: 'xlsx', sheet: 'Data', headerRow: 4, dataRowCount: 52, trimmedRows: 3 },
    ),
    L(
      HEAD,
      'import pandas as pd',
      '',
      'url = "https://x.gov/a.xlsx"',
      UA,
      '# Read the "Data" sheet. The column names are on row 4, so skip the 3 rows above them.',
      '# nrows=52 stops before the notes at the bottom of the sheet.',
      'df = pd.read_excel(url, sheet_name="Data", skiprows=3, nrows=52, storage_options={"User-Agent": "Mozilla/5.0"})',
      ...COLS,
    ),
  );
});

test('Excel export from a zip and an upload', () => {
  const zip = loadCell(
    { kind: 'zip', url: 'https://x.gov/a.zip', innerName: 'inner.xlsx' },
    { format: 'xlsx', sheet: 'S', headerRow: 2 },
  );
  assert.match(zip, /# Read the "S" sheet\. The column names are on row 2, so skip the 1 row above them\.\n/);
  assert.match(
    zip,
    /df = pd\.read_excel\(io\.BytesIO\(archive\.read\("inner\.xlsx"\)\), sheet_name="S", skiprows=1\)\n# Make every column name text/,
  );
  const up = loadCell({ kind: 'upload', filename: 'my.xlsx' }, { format: 'xlsx', sheet: 0, headerRow: 1 });
  assert.match(up, /df = pd\.read_excel\("my\.xlsx", sheet_name=0\)\n# Make every column name text .*\ndf\.columns = df\.columns\.astype\(str\)$/);
});

test('CSV export from a url', () => {
  assert.equal(
    loadCell({ kind: 'url', url: 'https://www2.census.gov/x.csv' }, csv),
    L(
      HEAD,
      'import pandas as pd',
      '',
      'url = "https://www2.census.gov/x.csv"',
      UA,
      'df = pd.read_csv(url, storage_options={"User-Agent": "Mozilla/5.0"})',
    ),
  );
});

test('CSV export from a zip', () => {
  assert.equal(
    loadCell({ kind: 'zip', url: 'https://x.gov/a.zip', innerName: 'inner.csv' }, csv),
    L(
      HEAD,
      'import io',
      'import urllib.request',
      'import zipfile',
      '',
      'import pandas as pd',
      '',
      'url = "https://x.gov/a.zip"',
      '# Download the zip file, then open the data file inside it.',
      'request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})',
      'with urllib.request.urlopen(request) as response:',
      '    archive = zipfile.ZipFile(io.BytesIO(response.read()))',
      'df = pd.read_csv(archive.open("inner.csv"))',
    ),
  );
});

test('CSV export of an uploaded file', () => {
  assert.equal(
    loadCell({ kind: 'upload', filename: 'my-data.csv' }, csv),
    L(
      HEAD,
      '# Put "my-data.csv" in the same folder as this notebook (in Colab, upload it with the Files panel).',
      'import pandas as pd',
      '',
      'df = pd.read_csv("my-data.csv")',
    ),
  );
});

test('dropColumns, dropRowsByPosition, dropRowsWhere', () => {
  assert.equal(
    actionCell({ kind: 'dropColumns', columns: ['SUMLEV', 'REGION'] }),
    L("# Drop columns we don't need", 'df = df.drop(columns=["SUMLEV", "REGION"])'),
  );
  assert.equal(
    actionCell({ kind: 'dropRowsByPosition', start: 10, end: 20 }),
    L('# Drop rows 10 through 20 (counting from 0)', 'df = df.drop(df.index[10:21])'),
  );
  assert.equal(
    actionCell({ kind: 'dropRowsWhere', condition: cond('AGE', '>', '65', true) }),
    L('# Drop rows where AGE > 65', 'df = df[~(df["AGE"] > 65)]'),
  );
  assert.equal(
    actionCell({ kind: 'dropRowsWhere', condition: cond('X', 'contains', 'abc', false) }),
    L('# Drop rows where X contains "abc"', 'df = df[~df["X"].astype("string").str.contains("abc", regex=False, na=False)]'),
  );
});

test('dropMissing variants', () => {
  const dm = (columns: string[], how: 'any' | 'all') => actionCell({ kind: 'dropMissing', columns, how });
  assert.equal(dm([], 'any'), L('# Drop rows that have any missing values', 'df = df.dropna()'));
  assert.equal(dm([], 'all'), L('# Drop rows where every value is missing', 'df = df.dropna(how="all")'));
  for (const how of ['any', 'all'] as const) {
    assert.equal(dm(['POP'], how), L('# Drop rows where POP is missing', 'df = df.dropna(subset=["POP"])'));
  }
  assert.equal(
    dm(['POP', 'AGE'], 'any'),
    L('# Drop rows where any of POP, AGE is missing', 'df = df.dropna(subset=["POP", "AGE"])'),
  );
  assert.equal(
    dm(['POP', 'AGE'], 'all'),
    L('# Drop rows where all of POP, AGE are missing', 'df = df.dropna(subset=["POP", "AGE"], how="all")'),
  );
});

test('fillMissing strategies', () => {
  const c = '"POPESTIMATE2020"';
  const col = `df[${c}]`;
  assert.equal(
    actionCell({ kind: 'fillMissing', columns: ['POPESTIMATE2020'], strategy: 'median' }),
    L("# Fill missing values in POPESTIMATE2020 with the column's median", `${col} = ${col}.fillna(${col}.median())`),
  );
  assert.match(
    actionCell({ kind: 'fillMissing', columns: ['POPESTIMATE2020'], strategy: 'mode' }),
    /\ndf\["POPESTIMATE2020"\] = df\["POPESTIMATE2020"\]\.fillna\(df\["POPESTIMATE2020"\]\.mode\(\)\[0\]\)$/,
  );
  assert.match(
    actionCell({ kind: 'fillMissing', columns: ['A'], strategy: 'value', value: '0', numeric: true }),
    /\.fillna\(0\)$/,
  );
  assert.match(
    actionCell({ kind: 'fillMissing', columns: ['A'], strategy: 'value', value: 'Unknown', numeric: false }),
    /\.fillna\("Unknown"\)$/,
  );
  assert.equal(
    actionCell({ kind: 'fillMissing', columns: ['A', 'B'], strategy: 'mean' }),
    L(
      "# Fill missing values in A, B with each column's mean",
      'df["A"] = df["A"].fillna(df["A"].mean())',
      'df["B"] = df["B"].fillna(df["B"].mean())',
    ),
  );
});

test('rename, changeType, filterRows, dropDuplicates', () => {
  assert.equal(
    actionCell({ kind: 'rename', from: 'STNAME', to: 'state' }),
    L('# Rename column STNAME to state', 'df = df.rename(columns={"STNAME": "state"})'),
  );
  assert.equal(
    actionCell({ kind: 'changeType', column: 'AGE', to: 'number' }),
    L("# Convert AGE to numbers (values that aren't numbers become missing)", 'df["AGE"] = pd.to_numeric(df["AGE"], errors="coerce")'),
  );
  assert.equal(
    actionCell({ kind: 'changeType', column: 'AGE', to: 'text' }),
    L('# Convert AGE to text', 'df["AGE"] = df["AGE"].astype("string")'),
  );
  assert.equal(
    actionCell({ kind: 'changeType', column: 'DATE', to: 'date' }),
    L("# Convert DATE to dates (values that aren't dates become missing)", 'df["DATE"] = pd.to_datetime(df["DATE"], errors="coerce")'),
  );
  assert.equal(
    actionCell({ kind: 'filterRows', condition: cond('STNAME', '==', 'Tennessee', false) }),
    L('# Keep only rows where STNAME == "Tennessee"', 'df = df[df["STNAME"] == "Tennessee"]'),
  );
  assert.equal(
    actionCell({ kind: 'filterRows', condition: cond('X', 'contains', 'abc', false) }),
    L('# Keep only rows where X contains "abc"', 'df = df[df["X"].astype("string").str.contains("abc", regex=False, na=False)]'),
  );
  assert.equal(actionCell({ kind: 'dropDuplicates' }), L('# Remove duplicate rows', 'df = df.drop_duplicates()'));
});

test('non-numeric text in a numeric condition is quoted, not emitted raw', () => {
  assert.equal(
    actionCell({ kind: 'filterRows', condition: cond('AGE', '>', '__import__("os")', true) }),
    L('# Keep only rows where AGE > "__import__(\\"os\\")"', 'df = df[df["AGE"] > "__import__(\\"os\\")"]'),
  );
});

test('column names with quotes and spaces go through pyStr', () => {
  const name = 'Pop "2020" est';
  assert.equal(
    actionCell({ kind: 'changeType', column: name, to: 'text' }),
    L(`# Convert ${name} to text`, 'df["Pop \\"2020\\" est"] = df["Pop \\"2020\\" est"].astype("string")'),
  );
  assert.match(actionCell({ kind: 'dropColumns', columns: [name] }), /columns=\["Pop \\"2020\\" est"\]\)$/);
});

test('newlines in names cannot break out of the comment line', () => {
  const out = actionCell({ kind: 'rename', from: 'a\nimport os', to: 'b' });
  assert.equal(out.split('\n').length, 2);
  assert.ok(out.split('\n')[1].includes('"a\\nimport os"'));
});

test('toIpynb builds an nbformat 4.5 notebook', () => {
  const text = toIpynb(['a = 1', 'b']);
  const nb = JSON.parse(text);
  assert.equal(nb.nbformat, 4);
  assert.equal(nb.nbformat_minor, 5);
  assert.equal(nb.metadata.kernelspec.name, 'python3');
  assert.equal(nb.cells.length, 2);
  for (const cell of nb.cells) {
    assert.equal(cell.cell_type, 'code');
    assert.deepEqual(cell.outputs, []);
    assert.equal(cell.execution_count, null);
    assert.equal(typeof cell.id, 'string');
    assert.ok(cell.id.length > 0);
  }
  assert.notEqual(nb.cells[0].id, nb.cells[1].id);
  assert.deepEqual(toIpynb(['x\ny\n']).includes('"x\\n"'), true);
  assert.deepEqual(JSON.parse(toIpynb(['l1\nl2'])).cells[0].source, ['l1\n', 'l2']);
  assert.match(text, /\n "nbformat": 4/);
});

test('numeric values are emitted bare only when plain decimals, normalised', () => {
  const lit = (value: string) =>
    actionCell({ kind: 'filterRows', condition: cond('A', '>', value, true) }).split('\n')[1];
  assert.equal(lit('007'), 'df = df[df["A"] > 7]');
  assert.equal(lit('1.50'), 'df = df[df["A"] > 1.5]');
  assert.equal(lit('-3'), 'df = df[df["A"] > -3]');
  assert.equal(lit('.5'), 'df = df[df["A"] > 0.5]');
  assert.equal(lit('0x10'), 'df = df[df["A"] > "0x10"]');
  assert.equal(lit('Infinity'), 'df = df[df["A"] > "Infinity"]');
  assert.equal(lit('1e999'), 'df = df[df["A"] > "1e999"]');
  assert.match(
    actionCell({ kind: 'fillMissing', columns: ['A'], strategy: 'value', value: '08', numeric: true }),
    /\.fillna\(8\)$/,
  );
});

test('contains is a literal, always-quoted match', () => {
  const f = actionCell({ kind: 'filterRows', condition: cond('X', 'contains', '(', false) });
  assert.equal(f.split('\n')[1], 'df = df[df["X"].astype("string").str.contains("(", regex=False, na=False)]');
  const d = actionCell({ kind: 'dropRowsWhere', condition: cond('X', 'contains', '5', true) });
  assert.equal(
    d,
    L('# Drop rows where X contains "5"', 'df = df[~df["X"].astype("string").str.contains("5", regex=False, na=False)]'),
  );
});
