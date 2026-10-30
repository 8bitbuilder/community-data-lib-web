// Generates the pandas code shown in notebook cells and in the .ipynb export.
// Pure module: no DOM, no runtime imports.

export type FileFormat = 'csv' | 'tsv' | 'xlsx' | 'xls';
export interface ReadSpec {
  format: FileFormat;
  encoding?: 'utf-8' | 'latin-1';
  sheet?: string | number;
  headerRow?: number;
  dataRowCount?: number;
  trimmedRows?: number;
}
export type LoadSource =
  | { kind: 'file'; filename: string } // in-browser (Pyodide FS)
  | { kind: 'url'; url: string } // export
  | { kind: 'zip'; url: string; innerName: string } // export
  | { kind: 'upload'; filename: string }; // export of an uploaded file
export type Op = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'contains';
export interface Condition {
  column: string;
  op: Op;
  value: string;
  numeric: boolean;
}
export type CleaningAction =
  | { kind: 'dropColumns'; columns: string[] }
  | { kind: 'dropRowsByPosition'; start: number; end: number } // inclusive, 0-based
  | { kind: 'dropRowsWhere'; condition: Condition }
  | { kind: 'dropMissing'; columns: string[]; how: 'any' | 'all' } // [] = all columns
  | {
      kind: 'fillMissing';
      columns: string[];
      strategy: 'mean' | 'median' | 'mode' | 'value';
      value?: string;
      numeric?: boolean;
    }
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'changeType'; column: string; to: 'number' | 'text' | 'date' }
  | { kind: 'filterRows'; condition: Condition }
  | { kind: 'dropDuplicates' };

/** A Python double-quoted string literal that is valid for any input. */
export function pyStr(s: string): string {
  let out = '"';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, '0')}`;
    else out += ch;
  }
  return out + '"';
}

/** Text for use inside a `#` comment: never spans lines. */
function commentText(s: string): string {
  let out = '';
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    const lineBreak = c < 0x20 || (c >= 0x7f && c <= 0x85) || c === 0x2028 || c === 0x2029;
    out += lineBreak ? ' ' : ch;
  }
  return out;
}

const HEADER = '# Load the dataset into a table called df';
const UA_HEADERS = '{"User-Agent": "Mozilla/5.0"}';

function isExcel(format: FileFormat): boolean {
  return format === 'xlsx' || format === 'xls';
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Explanation comments and read_excel arguments for an Excel read. */
function excelParts(read: ReadSpec): { comments: string[]; args: string[] } {
  const comments: string[] = [];
  const args: string[] = [];
  let first: string;
  if (read.sheet === undefined) {
    first = '# Read the first sheet.';
  } else if (typeof read.sheet === 'number') {
    first = `# Read sheet number ${read.sheet} (counting from 0).`;
    args.push(`sheet_name=${read.sheet}`);
  } else {
    first = `# Read the ${pyStr(commentText(read.sheet))} sheet.`;
    args.push(`sheet_name=${pyStr(read.sheet)}`);
  }
  const headerRow = read.headerRow ?? 1;
  if (headerRow > 1) {
    const skip = headerRow - 1;
    first += ` The column names are on row ${headerRow}, so skip the ${plural(skip, 'row')} above them.`;
    args.push(`skiprows=${skip}`);
  }
  comments.push(first);
  if ((read.trimmedRows ?? 0) > 0 && read.dataRowCount !== undefined) {
    comments.push(`# nrows=${read.dataRowCount} stops before the notes at the bottom of the sheet.`);
    args.push(`nrows=${read.dataRowCount}`);
  }
  return { comments, args };
}

const EXCEL_COLUMN_LINES = [
  '# Make every column name text (Excel stores headers like 2020 as numbers)',
  'df.columns = df.columns.astype(str)',
];

function csvExtras(read: ReadSpec): string[] {
  const extras: string[] = [];
  if (read.encoding === 'latin-1') extras.push('encoding="latin-1"');
  if (read.format === 'tsv') extras.push('sep="\\t"');
  return extras;
}

export function loadCell(source: LoadSource, read: ReadSpec): string {
  const excel = isExcel(read.format);
  const parts = excel ? excelParts(read) : { comments: [] as string[], args: [] as string[] };
  const extras = excel ? parts.args : csvExtras(read);
  const reader = excel ? 'pd.read_excel' : 'pd.read_csv';
  const call = (first: string, tail: string[] = []) =>
    `df = ${reader}(${[first, ...extras, ...tail].join(', ')})`;

  const lines: string[] = [HEADER];
  const imports = ['import pandas as pd'];

  switch (source.kind) {
    case 'file':
      lines.push(...imports, '', ...parts.comments, call(pyStr(source.filename)));
      break;
    case 'upload':
      lines.push(
        `# Put ${pyStr(commentText(source.filename))} in the same folder as this notebook (in Colab, upload it with the Files panel).`,
        ...imports,
        '',
        ...parts.comments,
        call(pyStr(source.filename)),
      );
      break;
    case 'url':
      lines.push(
        ...imports,
        '',
        `url = ${pyStr(source.url)}`,
        "# Some data providers block Python's default User-Agent, so identify as a browser.",
        ...parts.comments,
        call('url', [`storage_options=${UA_HEADERS}`]),
      );
      break;
    case 'zip': {
      const inner = excel
        ? `io.BytesIO(archive.read(${pyStr(source.innerName)}))`
        : `archive.open(${pyStr(source.innerName)})`;
      lines.push(
        'import io',
        'import urllib.request',
        'import zipfile',
        '',
        ...imports,
        '',
        `url = ${pyStr(source.url)}`,
        '# Download the zip file, then open the data file inside it.',
        `request = urllib.request.Request(url, headers=${UA_HEADERS})`,
        'with urllib.request.urlopen(request) as response:',
        '    archive = zipfile.ZipFile(io.BytesIO(response.read()))',
        ...parts.comments,
        call(inner),
      );
      break;
    }
  }
  if (excel) lines.push(...EXCEL_COLUMN_LINES);
  return lines.join('\n');
}

function colList(columns: string[]): string {
  return columns.map(pyStr).join(', ');
}

function names(columns: string[]): string {
  return commentText(columns.join(', '));
}

/** Numeric values are emitted verbatim only when they parse as finite numbers. */
function valueLiteral(value: string, numeric: boolean): string {
  const t = value.trim();
  if (numeric && t !== '' && Number.isFinite(Number(t))) return t;
  return pyStr(value);
}

function conditionExpr(c: Condition): string {
  const col = `df[${pyStr(c.column)}]`;
  const v = valueLiteral(c.value, c.numeric);
  if (c.op === 'contains') return `${col}.astype("string").str.contains(${v}, na=False)`;
  return `${col} ${c.op} ${v}`;
}

function conditionText(c: Condition): string {
  const v = valueLiteral(c.value, c.numeric);
  return commentText(`${c.column} ${c.op} ${v}`);
}

export function actionCell(action: CleaningAction): string {
  switch (action.kind) {
    case 'dropColumns':
      return `# Drop columns we don't need\ndf = df.drop(columns=[${colList(action.columns)}])`;
    case 'dropRowsByPosition':
      return `# Drop rows ${action.start} through ${action.end} (counting from 0)\ndf = df.drop(df.index[${action.start}:${action.end + 1}])`;
    case 'dropRowsWhere':
      return `# Drop rows where ${conditionText(action.condition)}\ndf = df[~(${conditionExpr(action.condition)})]`;
    case 'dropMissing': {
      const { columns, how } = action;
      if (columns.length === 0) {
        return how === 'any'
          ? '# Drop rows that have any missing values\ndf = df.dropna()'
          : '# Drop rows where every value is missing\ndf = df.dropna(how="all")';
      }
      if (columns.length === 1) {
        return `# Drop rows where ${names(columns)} is missing\ndf = df.dropna(subset=[${colList(columns)}])`;
      }
      const comment =
        how === 'any'
          ? `# Drop rows where any of ${names(columns)} is missing`
          : `# Drop rows where all of ${names(columns)} are missing`;
      const how_ = how === 'all' ? ', how="all"' : '';
      return `${comment}\ndf = df.dropna(subset=[${colList(columns)}]${how_})`;
    }
    case 'fillMissing': {
      const { columns, strategy } = action;
      let what: string;
      if (strategy === 'value') {
        what = valueLiteral(action.value ?? '', action.numeric ?? false);
      } else {
        what = columns.length === 1 ? `the column's ${strategy}` : `each column's ${strategy}`;
      }
      const lines = columns.map((name) => {
        const col = `df[${pyStr(name)}]`;
        const fill =
          strategy === 'mean'
            ? `${col}.mean()`
            : strategy === 'median'
              ? `${col}.median()`
              : strategy === 'mode'
                ? `${col}.mode()[0]`
                : valueLiteral(action.value ?? '', action.numeric ?? false);
        return `${col} = ${col}.fillna(${fill})`;
      });
      return [`# Fill missing values in ${names(columns)} with ${commentText(what)}`, ...lines].join('\n');
    }
    case 'rename':
      return `# Rename column ${commentText(action.from)} to ${commentText(action.to)}\ndf = df.rename(columns={${pyStr(action.from)}: ${pyStr(action.to)}})`;
    case 'changeType': {
      const col = `df[${pyStr(action.column)}]`;
      const n = commentText(action.column);
      if (action.to === 'number') {
        return `# Convert ${n} to numbers (values that aren't numbers become missing)\n${col} = pd.to_numeric(${col}, errors="coerce")`;
      }
      if (action.to === 'date') {
        return `# Convert ${n} to dates (values that aren't dates become missing)\n${col} = pd.to_datetime(${col}, errors="coerce")`;
      }
      return `# Convert ${n} to text\n${col} = ${col}.astype("string")`;
    }
    case 'filterRows':
      return `# Keep only rows where ${conditionText(action.condition)}\ndf = df[${conditionExpr(action.condition)}]`;
    case 'dropDuplicates':
      return '# Remove duplicate rows\ndf = df.drop_duplicates()';
  }
}

/** nbformat 4.5 JSON, 1-space indent. */
export function toIpynb(cells: string[]): string {
  const nb = {
    cells: cells.map((code, i) => {
      const parts = code.split('\n');
      return {
        cell_type: 'code',
        execution_count: null,
        id: `cell-${i + 1}`,
        metadata: {},
        outputs: [],
        source: parts.map((line, j) => (j < parts.length - 1 ? `${line}\n` : line)),
      };
    }),
    metadata: {
      kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
      language_info: { name: 'python' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
  return JSON.stringify(nb, null, 1) + '\n';
}
