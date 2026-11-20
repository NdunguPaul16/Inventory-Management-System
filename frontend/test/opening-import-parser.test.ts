import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { parseOpeningFile, parseOpeningRows } from '../src/modules/inventory/opening-import';

describe('opening-stock file parsing', () => {
  it('parses quoted CSV cells, UTC dates and serial lists for review', async () => {
    const file = {
      name: 'opening.csv',
      size: 200,
      text: async () =>
        'sku,locationCode,quantity,unitCostCents,receivedAt,serialNumbers\r\n"CUE, BLUE",WH,0.5,101,2026-01-15,"SER-1; SER-2"\r\n',
    } as File;
    expect(await parseOpeningFile(file)).toEqual([
      {
        lineId: 'row-2',
        sku: 'CUE, BLUE',
        locationCode: 'WH',
        quantity: '0.5',
        unitCost: 101,
        receivedAt: '2026-01-15T00:00:00.000Z',
        serialNumbers: ['SER-1', 'SER-2'],
      },
    ]);
  });

  it('rejects invalid cost, date and zero quantity before any API call', () => {
    const header = ['sku', 'locationCode', 'quantity', 'unitCostCents', 'receivedAt'];
    expect(() => parseOpeningRows([header, ['A', 'WH', '1', '1.5', '']])).toThrow('unitCostCents');
    expect(() => parseOpeningRows([header, ['A', 'WH', '1', '10', '2026-02-30']])).toThrow(
      'valid calendar date',
    );
    expect(() => parseOpeningRows([header, ['A', 'WH', '0', '10', '']])).toThrow(
      'greater than zero',
    );
  });

  it('rejects unsupported formats and oversized files', async () => {
    await expect(parseOpeningFile({ name: 'opening.xls', size: 1 } as File)).rejects.toThrow(
      '.csv or .xlsx',
    );
    await expect(
      parseOpeningFile({ name: 'opening.csv', size: 2_000_001 } as File),
    ).rejects.toThrow('smaller than 2 MB');
  });

  it('reads a real XLSX worksheet and applies the same row validation', async () => {
    const relationships = 'http://schemas.openxmlformats.org/package/2006/relationships';
    const spreadsheet = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const headers = ['sku', 'locationCode', 'quantity', 'unitCostCents', 'receivedAt'];
    const headerCells = headers
      .map((name, index) => `<c r="${'ABCDE'[index]}1" t="inlineStr"><is><t>${name}</t></is></c>`)
      .join('');
    const textCell = (column: string, text: string) =>
      `<c r="${column}2" t="inlineStr"><is><t>${text}</t></is></c>`;
    const sheet = `<worksheet xmlns="${spreadsheet}"><dimension ref="A1:E2"/><sheetData><row r="1">${headerCells}</row><row r="2">${textCell('A', 'CUE-1')}${textCell('B', 'WH')}<c r="C2"><v>0.5</v></c><c r="D2"><v>101</v></c>${textCell('E', '2026-01-15')}</row></sheetData></worksheet>`;
    const files = {
      '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`,
      '_rels/.rels': `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="${relationships}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<workbook xmlns="${spreadsheet}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relationships}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml': sheet,
    };
    const zipped = zipSync(
      Object.fromEntries(Object.entries(files).map(([name, xml]) => [name, strToU8(xml)])),
    );
    const workbook = {
      name: 'opening.xlsx',
      size: zipped.byteLength,
      arrayBuffer: async () => Uint8Array.from(zipped).buffer,
    } as File;
    await expect(parseOpeningFile(workbook)).resolves.toMatchObject([
      { sku: 'CUE-1', locationCode: 'WH', quantity: '0.5', unitCost: 101 },
    ]);
  });
});
