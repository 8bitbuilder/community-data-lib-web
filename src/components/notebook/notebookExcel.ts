// Excel layout detection in the browser for the notebook. SheetJS is loaded
// lazily, only when an Excel file is involved.
import { parseSheetParam, type BackendSource, type ExcelLayout } from '@lib/api/backend';

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
export function pageExcelLayout(): ExcelLayout | undefined {
  return (window as unknown as { __cdlExcelLayout?: ExcelLayout }).__cdlExcelLayout;
}

/** The catalog file's Excel layout: the preview's, or worked out here if the preview hasn't loaded. */
export async function catalogLayout(bytes: Uint8Array, source: BackendSource): Promise<ExcelLayout> {
  const fromPage = pageExcelLayout();
  if (fromPage) return fromPage;
  const params = new URLSearchParams(window.location.search);
  const headerRow = Number.parseInt(params.get('header_row') ?? '', 10);
  const curator = { sheet: source.download?.sheet, headerRow: source.download?.header_row };
  // The page URL's `sheet` is a 0-based index (see SheetParam), never a name.
  const visitor = {
    sheet: parseSheetParam(params.get('sheet')),
    headerRow: Number.isInteger(headerRow) && headerRow > 0 ? headerRow : undefined,
  };
  try {
    return await readLayout(bytes, { visitor, curator });
  } catch (e) {
    // A stale link (sheet or header row no longer in the file): use the default, like the page does.
    if (visitor.sheet === undefined && visitor.headerRow === undefined) throw e;
    return readLayout(bytes, { curator });
  }
}
