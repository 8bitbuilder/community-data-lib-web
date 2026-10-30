// Excel layout detection in the browser for the notebook. SheetJS is loaded
// lazily, only when an Excel file is involved.
import type { BackendSource, ExcelLayout } from '@lib/api/backend';

type ExcelModule = typeof import('@lib/data/excelLayout.mjs');
type ReadOptions = Parameters<ExcelModule['readExcelTable']>[1];

let excelModule: Promise<ExcelModule> | null = null;
function loadExcelModule(): Promise<ExcelModule> {
  excelModule ??= import('@lib/data/excelLayout.mjs');
  return excelModule;
}

export async function readLayout(bytes: Uint8Array, options: ReadOptions): Promise<ExcelLayout> {
  const { readExcelTable } = await loadExcelModule();
  return readExcelTable(bytes, options).layout as ExcelLayout;
}

/** The layout the preview page last reported (see data-preview.astro). */
function pageExcelLayout(): ExcelLayout | undefined {
  return (window as unknown as { __cdlExcelLayout?: ExcelLayout }).__cdlExcelLayout;
}

/**
 * Layout for an uploaded workbook. If it's the catalog dataset, match what the
 * preview shows (the visitor's sheet / header row choice), else the curator's
 * defaults, else auto-detect. A different file just falls through to auto-detect.
 */
export async function uploadLayout(bytes: Uint8Array, source: BackendSource): Promise<ExcelLayout> {
  const page = pageExcelLayout();
  const curator = { sheet: source.download?.sheet, headerRow: source.download?.header_row };
  const attempts: ReadOptions[] = [];
  if (page) attempts.push({ visitor: { sheet: page.sheet, headerRow: page.headerRow } });
  if (curator.sheet !== undefined || curator.headerRow !== undefined) attempts.push({ curator });
  for (const options of attempts) {
    try {
      return await readLayout(bytes, options);
    } catch {
      // Not this file's sheet / row: try the next, ending with auto-detect.
    }
  }
  return readLayout(bytes, {});
}
