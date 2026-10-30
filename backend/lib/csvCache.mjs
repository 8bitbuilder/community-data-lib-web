import { parse } from "csv-parse/sync";
import AdmZip from "adm-zip";
import { readExcelTable } from "../../src/lib/data/excelLayout.mjs";

const CACHE_TTL_MS = 15 * 60 * 1000;
const fileCache = new Map();
const tableCache = new Map();
const MAX_TABLE_ENTRIES = 50;

export function tableCacheSize() {
  return tableCache.size;
}

function isZip(data) {
  return data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && data[2] === 0x03 && data[3] === 0x04;
}

function isXlsx(data) {
  if (!isZip(data)) return false;
  try {
    const zip = new AdmZip(data);
    return zip.getEntries().some((e) => e.entryName === "xl/workbook.xml");
  } catch {
    return false;
  }
}

function pickFileFromZip(data) {
  const zip = new AdmZip(data);
  const entries = zip
    .getEntries()
    .filter(
      (e) =>
        !e.isDirectory &&
        /\.(csv|tsv|xlsx|xls)$/i.test(e.entryName),
    )
    .sort((a, b) => a.entryName.localeCompare(b.entryName));

  if (entries.length === 0) {
    throw new Error("ZIP archive contains no CSV, TSV or Excel files");
  }

  return { data: entries[0].getData(), filename: entries[0].entryName };
}

function isOle(data) {
  return (
    data.length >= 4 && data[0] === 0xd0 && data[1] === 0xcf && data[2] === 0x11 && data[3] === 0xe0
  );
}

function formatOf(data, filename) {
  const ext = filename.split("?")[0].toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (isOle(data)) return "xls";
  if (isXlsx(data)) return "xlsx";
  if (ext === "xlsx" || ext === "xls") return ext;
  return ext === "tsv" ? "tsv" : "csv";
}

function lastSegment(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : "download";
  } catch {
    return "download";
  }
}

function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 5);
  if (lines.length === 0) return ",";
  const delimiters = [",", "\t", ";", "|"];
  for (const delim of delimiters) {
    const counts = lines.map((l) => l.split(delim).length - 1);
    if (counts.every((c) => c === counts[0] && c > 0)) return delim;
  }
  return ",";
}

function decodeText(data) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return new TextDecoder("latin1").decode(data);
  }
}

function parseCsvBytes(data) {
  const text = decodeText(data);
  const delimiter = detectDelimiter(text);
  const records = parse(text, {
    delimiter,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  });
  if (!records.length) {
    throw new Error("File appears to be empty");
  }
  const headers = records[0].map((h) => String(h ?? "").trim());
  const rows = records.slice(1).map((row) => row.map((cell) => String(cell ?? "").trim()));
  return { headers, rows };
}

async function downloadBytes(url) {
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; CDL-Backend/1.0)" },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`Download failed: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export function isExcelFormat(format) {
  return format === "xlsx" || format === "xls";
}

/** Download (and unzip) the source's file once; cached per source id. */
export async function getSourceFile(source) {
  const cached = fileCache.get(source.id);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.file;

  const downloadUrl = source.download?.url;
  if (!downloadUrl) throw new Error("Source has no download URL");

  let bytes = await downloadBytes(downloadUrl);
  let filename = lastSegment(downloadUrl);
  let archive = null;
  // Zipped sources: the full entry name inside the zip (e.g. "data/sub/file.csv").
  let archiveEntry = null;
  if (isZip(bytes) && !isXlsx(bytes)) {
    const extracted = pickFileFromZip(bytes);
    bytes = extracted.data;
    archiveEntry = extracted.filename;
    filename = extracted.filename.split("/").pop();
    archive = "zip";
  }
  const file = { bytes, filename, format: formatOf(bytes, filename), archive, archiveEntry };
  fileCache.set(source.id, { file, fetchedAt: Date.now() });
  return file;
}

export async function getSourceTable(source, { sheet, headerRow } = {}) {
  const key = `${source.id}|${sheet ?? ""}|${headerRow ?? ""}`;
  const cached = tableCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.table;

  const file = await getSourceFile(source);
  let table;
  if (isExcelFormat(file.format)) {
    const dl = source.download ?? {};
    table = readExcelTable(file.bytes, {
      visitor: { sheet, headerRow },
      curator: { sheet: dl.sheet, headerRow: dl.header_row },
    });
  } else {
    table = parseCsvBytes(file.bytes);
  }
  const now = Date.now();
  for (const [k, v] of tableCache) if (now - v.fetchedAt >= CACHE_TTL_MS) tableCache.delete(k);
  tableCache.delete(key);
  tableCache.set(key, { table, fetchedAt: now });
  // Map iterates in insertion order, so the oldest entries go first.
  while (tableCache.size > MAX_TABLE_ENTRIES) tableCache.delete(tableCache.keys().next().value);
  return table;
}

export function clearCache(sourceId) {
  if (sourceId) {
    fileCache.delete(sourceId);
    for (const k of tableCache.keys()) if (k.startsWith(`${sourceId}|`)) tableCache.delete(k);
  } else {
    fileCache.clear();
    tableCache.clear();
  }
}
