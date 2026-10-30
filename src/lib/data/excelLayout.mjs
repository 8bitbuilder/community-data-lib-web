// Isomorphic Excel layout detection (Node + browser). No Node builtins.
import * as XLSX from 'xlsx';

/** @typedef {'visitor'|'curator'|'auto'} LayoutOrigin */
/** @typedef {{ format: 'xlsx'|'xls', sheets: string[], sheet: string, headerRow: number,
 *   dataRowCount: number, trimmedRows: number,
 *   origin: { sheet: LayoutOrigin, headerRow: LayoutOrigin } }} ExcelLayout */

export class LayoutError extends Error {
  /** @param {'NO_DATA'|'UNKNOWN_SHEET'|'HEADER_OUT_OF_RANGE'} code @param {string} message @param {string[]} [sheets] */
  constructor(code, message, sheets = []) {
    super(message);
    this.name = 'LayoutError';
    this.code = code;
    this.sheets = sheets;
  }
}

const HEADER_SCAN_ROWS = 20;
const NOTE_RE = /^(note|source|footnote|\*|\(x\)|\d+[.)])/i;

const isBlankRow = (row) => row.every((c) => c === '');
const nonEmptyCount = (row) => row.reduce((n, c) => n + (c === '' ? 0 : 1), 0);

function isTextLike(cell) {
  if (/^\d{4}$/.test(cell)) {
    const n = Number(cell);
    if (n >= 1800 && n <= 2100) return true;
  }
  // Numeric (allowing thousands separators, %, $, sign, decimals) is not text.
  return !/^[-+]?[$]?\d[\d,]*(\.\d+)?%?$|^[-+]?[$]?\.\d+%?$/.test(cell);
}

/** @param {string[][]} grid @returns {number} 1-based header row */
export function detectHeaderRow(grid) {
  const width = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (!width) return 1;
  const limit = Math.min(grid.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const row = grid[i];
    const filled = nonEmptyCount(row);
    if (filled < 0.6 * width) continue;
    const text = row.filter((c) => c !== '' && isTextLike(c)).length;
    if (text * 2 <= filled) continue;
    const next = grid[i + 1];
    if (!next || nonEmptyCount(next) < 1) continue;
    return i + 1;
  }
  return 1;
}

/** @param {string[][]} grid @param {number} headerIndex 0-based @returns {number} 0-based exclusive end */
export function findDataEnd(grid, headerIndex) {
  let end = grid.length;
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const row = grid[i];
    if (isBlankRow(row)) {
      // 2+ consecutive blank rows end the region (a lone trailing blank is trimmed below).
      if (i + 1 < grid.length && isBlankRow(grid[i + 1])) {
        end = i;
        break;
      }
      continue;
    }
    if (row[0] !== '' && nonEmptyCount(row) === 1 && NOTE_RE.test(row[0])) {
      end = i;
      break;
    }
  }
  while (end > headerIndex + 1 && isBlankRow(grid[end - 1])) end--;
  return end;
}

/** @param {string[]} rawHeaders @returns {string[]} */
export function pandasColumnNames(rawHeaders) {
  const seen = new Map();
  const used = new Set();
  return rawHeaders.map((raw, i) => {
    const base = raw === '' ? `Unnamed: ${i}` : raw;
    let name = base;
    if (used.has(name)) {
      let k = seen.get(base) ?? 0;
      do {
        k++;
        name = `${base}.${k}`;
      } while (used.has(name));
      seen.set(base, k);
    }
    used.add(name);
    return name;
  });
}

function sheetGrid(ws) {
  if (!ws || !ws['!ref']) return [];
  // Anchor at A1 so row/column numbers match what a person sees in Excel.
  const r = XLSX.utils.decode_range(ws['!ref']);
  const range = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: r.e });
  const raw = XLSX.utils.sheet_to_json(ws, {
    range,
    header: 1,
    raw: false,
    defval: '',
    blankrows: true,
    dateNF: 'yyyy-mm-dd',
  });
  const width = raw.reduce((m, r) => Math.max(m, r.length), 0);
  return raw.map((r) => {
    const out = r.map((c) => String(c ?? '').trim());
    while (out.length < width) out.push('');
    return out;
  });
}

function region(grid, headerRowOverride) {
  const headerRow = headerRowOverride ?? detectHeaderRow(grid);
  const headerIndex = headerRow - 1;
  const end = findDataEnd(grid, headerIndex);
  return { headerRow, headerIndex, end };
}

function detectFormat(bytes) {
  if (bytes.length >= 4 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return 'xls';
  }
  return 'xlsx';
}

const given = (v) => v !== undefined && v !== null;

/**
 * @param {Uint8Array} bytes
 * @param {{ visitor?: {sheet?: string|number|null, headerRow?: number|null},
 *           curator?: {sheet?: string|number|null, headerRow?: number|null} }} [options]
 * @returns {{ headers: string[], rows: string[][], layout: ExcelLayout }}
 */
export function readExcelTable(bytes, options = {}) {
  const wb = XLSX.read(bytes, { type: 'array', cellDates: true });
  const sheets = wb.SheetNames;
  const visitor = options.visitor ?? {};
  const curator = options.curator ?? {};

  /** @type {LayoutOrigin} */
  let sheetOrigin = 'auto';
  let sheetSel = null;
  if (given(visitor.sheet)) {
    sheetOrigin = 'visitor';
    sheetSel = visitor.sheet;
  } else if (given(curator.sheet)) {
    sheetOrigin = 'curator';
    sheetSel = curator.sheet;
  }

  let sheet;
  if (sheetSel !== null) {
    sheet = typeof sheetSel === 'number' ? sheets[sheetSel] : sheets.find((s) => s === sheetSel);
    if (sheet === undefined) {
      throw new LayoutError('UNKNOWN_SHEET', `Unknown sheet: ${String(sheetSel)}`, sheets);
    }
  } else {
    sheet = sheets.find((name) => {
      const g = sheetGrid(wb.Sheets[name]);
      if (!g.length) return false;
      const { headerIndex, end } = region(g, null);
      const width = g[0].length;
      const dataRows = g.slice(headerIndex + 1, end).filter((r) => !isBlankRow(r)).length;
      return width >= 2 && dataRows >= 2;
    });
    sheet = sheet ?? sheets[0];
  }
  if (sheet === undefined) throw new LayoutError('NO_DATA', 'Workbook has no sheets', sheets);

  const grid = sheetGrid(wb.Sheets[sheet]);
  if (!grid.length || grid.every(isBlankRow)) {
    throw new LayoutError('NO_DATA', `Sheet "${sheet}" has no data`, sheets);
  }

  /** @type {LayoutOrigin} */
  let headerOrigin = 'auto';
  let headerOverride = null;
  if (given(visitor.headerRow)) {
    headerOrigin = 'visitor';
    headerOverride = visitor.headerRow;
  } else if (given(curator.headerRow)) {
    headerOrigin = 'curator';
    headerOverride = curator.headerRow;
  }
  if (headerOverride !== null && (!Number.isInteger(headerOverride) || headerOverride < 1 || headerOverride > grid.length)) {
    throw new LayoutError('HEADER_OUT_OF_RANGE', `Header row ${headerOverride} is outside 1-${grid.length}`, sheets);
  }

  const { headerRow, headerIndex, end } = region(grid, headerOverride);
  const headers = pandasColumnNames(grid[headerIndex]);
  const rows = grid.slice(headerIndex + 1, end); // interior blank rows are kept: pandas returns them as all-NaN rows

  return {
    headers,
    rows,
    layout: {
      format: detectFormat(bytes),
      sheets,
      sheet,
      headerRow,
      dataRowCount: end - (headerIndex + 1),
      trimmedRows: grid.length - end,
      origin: { sheet: sheetOrigin, headerRow: headerOrigin },
    },
  };
}
