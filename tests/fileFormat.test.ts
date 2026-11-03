import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import AdmZip from 'adm-zip';

// @ts-expect-error plain .mjs module without types
import { detectFileFormat, readFromZip } from '../backend/lib/fileFormat.mjs';
// @ts-expect-error plain .mjs module without types
import { parseXlsxBytes } from '../backend/lib/xlsxTable.mjs';

const FIXTURE = readFileSync('tests/fixtures/preview-table.xlsx');
const XLS = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(64)]);

function zipOf(files: Record<string, Buffer | string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(files)) zip.addFile(name, Buffer.from(content));
  return zip.toBuffer();
}

test('plain files are told apart by their bytes', () => {
  assert.equal(detectFileFormat(Buffer.from('a,b\n1,2\n'), 'data.csv'), 'csv');
  assert.equal(detectFileFormat(Buffer.from('a\tb\n1\t2\n'), 'data.TSV'), 'tsv');
  assert.equal(detectFileFormat(FIXTURE, 'no-extension'), 'xlsx');
  assert.equal(detectFileFormat(XLS, 'no-extension'), 'xls');
});

test('a zip is named for the table inside it', () => {
  assert.equal(detectFileFormat(zipOf({ 'a.csv': 'a,b\n' })), 'zip/csv');
  assert.equal(detectFileFormat(zipOf({ 'a.tsv': 'a\tb\n' })), 'zip/tsv');
  assert.equal(detectFileFormat(zipOf({ 'a.xlsx': FIXTURE })), 'zip/xlsx');
  assert.equal(detectFileFormat(zipOf({ 'a.xls': XLS })), 'zip/xls');
});

test('a zip prefers a CSV over a workbook', () => {
  assert.equal(detectFileFormat(zipOf({ 'a.xlsx': FIXTURE, 'b.csv': 'a,b\n' })), 'zip/csv');
});

test('a zip with no table is named for its largest file', () => {
  const format = detectFileFormat(zipOf({ 'readme.pdf': 'x', 'database.accdb': 'much longer than the readme' }));
  assert.equal(format, 'zip/accdb');
});

test('the first file of a type can be read from a zip', () => {
  const zip = zipOf({ 'b.csv': 'second', 'a.csv': 'first', 'c.pdf': 'other' });
  assert.equal(readFromZip(zip, 'csv').toString(), 'first');
  assert.equal(readFromZip(zip, 'xlsx'), null);
});

test('an xlsx becomes the same headers and rows a CSV produces', () => {
  assert.deepEqual(parseXlsxBytes(FIXTURE), {
    headers: ['Area', 'Estimate / 2024', 'Estimate / 2025', 'Percent'],
    rows: [
      ['Tennessee', '7126489', '7227750', '78.9'],
      ['Knox County', '494574', '500123', '80.5'],
    ],
  });
});

function sheet(body: string): string {
  return `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

test('the first sheet follows the workbook order, not the file names', () => {
  const book = zipOf({
    'xl/workbook.xml':
      '<workbook xmlns:r="r"><sheets><sheet name="Second" r:id="rId2"/><sheet name="First" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>wrong</t></is></c><c r="B1"><v>1</v></c></row>'),
    'xl/worksheets/sheet2.xml': sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>right</t></is></c><c r="B1"><v>2</v></c></row>'),
  });
  assert.deepEqual(parseXlsxBytes(book).rows, [['right', '2']]);
});

test('a sheet of text uses its first filled row as the header', () => {
  const inline = (ref: string, text: string) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`;
  const book = zipOf({
    'xl/workbook.xml': '<workbook/>',
    'xl/worksheets/sheet1.xml': sheet(
      `<row r="1">${inline('A1', 'Title')}</row>` +
        `<row r="2">${inline('A2', 'School')}${inline('B2', 'Zone &amp; Ward')}</row>` +
        `<row r="3">${inline('A3', 'Fulton')}${inline('B3', 'North')}</row>`,
    ),
  });
  assert.deepEqual(parseXlsxBytes(book), { headers: ['School', 'Zone & Ward'], rows: [['Fulton', 'North']] });
});

test('a sheet with no table is an error, not an empty preview', () => {
  const book = zipOf({ 'xl/workbook.xml': '<workbook/>', 'xl/worksheets/sheet1.xml': sheet('') });
  assert.throws(() => parseXlsxBytes(book), /No table found/);
});
