import { openingStockImportSchema, type OpeningStockImportInput } from '@ims/shared';

type ImportLine = OpeningStockImportInput['lines'][number];

const HEADERS = ['sku', 'locationCode', 'quantity', 'unitCostCents', 'receivedAt', 'serialNumbers'];
const MAX_FILE_BYTES = 2_000_000;

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (closedQuote && char !== ',' && char !== '\n' && char !== '\r') {
      throw new Error('The CSV file contains text after a quoted field.');
    }
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (quoted) {
        quoted = false;
        closedQuote = true;
      } else if (cell === '') {
        quoted = true;
      } else {
        throw new Error('The CSV file contains an invalid quote.');
      }
    } else if (char === ',' && !quoted) {
      row.push(cell);
      cell = '';
      closedQuote = false;
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      closedQuote = false;
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('The CSV file ends inside a quoted field.');
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function value(cell: unknown): string {
  if (cell === null || cell === undefined) return '';
  if (cell instanceof Date) return cell.toISOString().slice(0, 10);
  if (typeof cell === 'boolean') throw new Error('Boolean cells are not valid opening-stock data.');
  if (typeof cell === 'number' && !Number.isFinite(cell)) {
    throw new Error('Opening-stock numbers must be finite.');
  }
  if (typeof cell !== 'string' && typeof cell !== 'number') {
    throw new Error('The sheet contains an unsupported cell value.');
  }
  return String(cell).trim();
}

function utcDate(input: string, row: number): string | undefined {
  if (!input) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    throw new Error(`Row ${row}: receivedAt must use YYYY-MM-DD.`);
  }
  const date = new Date(`${input}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input) {
    throw new Error(`Row ${row}: receivedAt is not a valid calendar date.`);
  }
  return date.toISOString();
}

export function parseOpeningRows(rows: unknown[][]): ImportLine[] {
  const [headings, ...data] = rows;
  if (!headings) throw new Error('The file has no header row.');
  const columns = new Map<string, number>();
  for (const [index, heading] of headings.entries()) {
    const name = value(heading).toLowerCase();
    if (name && columns.has(name)) throw new Error(`Duplicate column: ${name}.`);
    if (name) columns.set(name, index);
  }
  for (const heading of HEADERS.slice(0, 4)) {
    if (!columns.has(heading.toLowerCase())) throw new Error(`Missing column: ${heading}.`);
  }
  const lines: ImportLine[] = [];
  for (const [index, cells] of data.entries()) {
    const row = index + 2;
    if (cells.every((cell) => value(cell) === '')) continue;
    if (lines.length >= 100)
      throw new Error('An opening-stock import can contain at most 100 rows.');
    const at = (heading: string) => value(cells[columns.get(heading.toLowerCase()) ?? -1]);
    const costText = at('unitCostCents');
    if (!/^\d+$/.test(costText) || !Number.isSafeInteger(Number(costText))) {
      throw new Error(`Row ${row}: unitCostCents must be a non-negative whole cent amount.`);
    }
    const serials = at('serialNumbers')
      .split(';')
      .map((serial) => serial.trim())
      .filter(Boolean);
    lines.push({
      lineId: `row-${row}`,
      sku: at('sku'),
      locationCode: at('locationCode'),
      quantity: at('quantity'),
      unitCost: Number(costText),
      ...(at('receivedAt') ? { receivedAt: utcDate(at('receivedAt'), row) } : {}),
      ...(serials.length ? { serialNumbers: serials } : {}),
    });
  }
  const checked = openingStockImportSchema.safeParse({
    sourceDoc: { type: 'OPENING_IMPORT', id: 'preview', number: 'preview' },
    lines,
  });
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const lineIndex = typeof issue?.path[1] === 'number' ? issue.path[1] : undefined;
    throw new Error(
      `${lineIndex === undefined ? 'Import' : `Row ${lineIndex + 2}`}: ${issue?.message ?? 'invalid data'}`,
    );
  }
  return checked.data.lines;
}

export async function parseOpeningFile(file: File): Promise<ImportLine[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose a file smaller than 2 MB.');
  const name = file.name.toLowerCase();
  if (name.endsWith('.csv'))
    return parseOpeningRows(csvRows((await file.text()).replace(/^\uFEFF/, '')));
  if (name.endsWith('.xlsx')) {
    const { readSheet } = await import('read-excel-file/browser');
    return parseOpeningRows(await readSheet(await file.arrayBuffer()));
  }
  throw new Error('Choose a .csv or .xlsx file.');
}
