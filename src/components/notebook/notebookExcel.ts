// Excel layout detection in the browser for the notebook. SheetJS is loaded
// lazily, only when an Excel file is involved.
import type { BackendSource, ExcelLayout } from '@lib/api/backend';

export type NotebookSource = Pick<BackendSource, 'provider' | 'download'>;

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

/**
 * Layout for an uploaded workbook: the curator's defaults, else auto-detect. A
 * different file just falls through to auto-detect.
 */
export async function uploadLayout(bytes: Uint8Array, source: NotebookSource): Promise<ExcelLayout> {
  const curator = { sheet: source.download?.sheet, headerRow: source.download?.header_row };
  if (curator.sheet !== undefined || curator.headerRow !== undefined) {
    try {
      return await readLayout(bytes, { curator });
    } catch {
      // Not this file's sheet / row: auto-detect.
    }
  }
  return readLayout(bytes, {});
}
