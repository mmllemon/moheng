import ExcelJS from 'exceljs';
import { preflightZip } from './budget-xlsx.js';

/**
 * 通用 XLSX 表格导入：解码、工作簿检视、模板生成。
 *
 * 目标成本清单（budget-xlsx.ts）已经跑通一整套「模板 → 上传 → 检视 → 预检 → 事务提交」，
 * 但它是按清单定制的。这里把与业务无关的那半抽出来，供实际成本、进度款、分供合同等复用，
 * 新增一种导入时只需要提供列定义与行解析函数。
 */

export const IMPORT_XLSX_MAX_BYTES = 8 * 1024 * 1024;
export const IMPORT_XLSX_MAX_ROWS = 5000;
const MAX_WORKSHEETS = 10;
const MAX_COLUMNS = 40;

export class ImportXlsxError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ImportXlsxError';
  }
}

export type ImportColumn = { header: string; width?: number; numFmt?: string };
export type ImportTemplateSpec = {
  sheetName: string;
  columns: ImportColumn[];
  instructions: Array<[string, string]>;
};

export type ImportInspection = {
  sheetName: string;
  headers: string[];
  rows: string[][];
  cellTypes: string[][];
  rowCount: number;
  maxRows: number;
};

const normalized = (value: string) => value.replace(/[\s_（）()]/g, '').toLocaleLowerCase();

export function decodeXlsxUpload(filename: unknown, base64: unknown): Buffer {
  if (typeof filename !== 'string' || !filename.toLocaleLowerCase().endsWith('.xlsx')) {
    throw new ImportXlsxError('XLSX_FILE_TYPE_INVALID', '仅接受 .xlsx 文件；.xls、.xlsm 和其他格式不受支持');
  }
  if (typeof base64 !== 'string' || base64.length === 0) throw new ImportXlsxError('XLSX_FILE_REQUIRED', '未收到有效的 XLSX 文件内容');
  if (base64.length > Math.ceil(IMPORT_XLSX_MAX_BYTES * 4 / 3) + 8) throw new ImportXlsxError('XLSX_FILE_TOO_LARGE', 'XLSX 文件不能超过 8 MB');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new ImportXlsxError('XLSX_BASE64_INVALID', '文件编码不正确，请重新选择文件');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > IMPORT_XLSX_MAX_BYTES) throw new ImportXlsxError('XLSX_FILE_TOO_LARGE', 'XLSX 文件为空或超过 8 MB');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new ImportXlsxError('XLSX_CONTAINER_INVALID', '文件不是有效的 XLSX/ZIP 工作簿');
  preflightZip(buffer);
  return buffer;
}

export async function buildImportTemplate(spec: ImportTemplateSpec): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '墨衡工程经营管理系统';
  workbook.created = new Date();
  workbook.subject = `${spec.sheetName}导入模板`;

  const sheet = workbook.addWorksheet(spec.sheetName, {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = spec.columns.map((column) => ({
    header: column.header,
    key: column.header,
    width: column.width ?? 18,
    ...(column.numFmt ? { style: { numFmt: column.numFmt } } : {}),
  }));
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell((cell) => { cell.border = { bottom: { style: 'medium', color: { argb: 'FF163A59' } } }; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: spec.columns.length } };

  const instructions = workbook.addWorksheet('填报说明');
  instructions.columns = [{ width: 24 }, { width: 100 }];
  instructions.addRow(['项目', '说明']);
  for (const [label, text] of spec.instructions) instructions.addRow([label, text]);
  instructions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instructions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
  instructions.eachRow((row) => {
    row.height = 28;
    row.alignment = { vertical: 'middle', wrapText: true };
    row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9E1EA' } } }; });
  });
  instructions.getColumn(1).font = { bold: true, color: { argb: 'FF334155' } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function cellType(cell: ExcelJS.Cell): string {
  if (cell.type === ExcelJS.ValueType.Number) return 'number';
  if (cell.type === ExcelJS.ValueType.Date) return 'date';
  if (cell.type === ExcelJS.ValueType.Boolean) return 'boolean';
  if (cell.type === ExcelJS.ValueType.Null || cell.value == null) return 'empty';
  return 'text';
}

function cellText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value == null) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && 'richText' in value && Array.isArray(value.richText)) return value.richText.map((part) => part.text).join('');
  if (typeof value === 'object' && 'text' in value && typeof value.text === 'string') return value.text;
  return '';
}

export async function inspectImportWorkbook(buffer: Buffer, options: { sheetNames: string[]; maxRows?: number }): Promise<ImportInspection> {
  const maxRows = options.maxRows ?? IMPORT_XLSX_MAX_ROWS;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new ImportXlsxError('XLSX_WORKBOOK_INVALID', '无法解析工作簿，请用 Excel 或 WPS 重新另存为 .xlsx 后重试');
  }
  if (workbook.worksheets.length > MAX_WORKSHEETS) throw new ImportXlsxError('XLSX_TOO_MANY_SHEETS', `工作簿最多允许 ${MAX_WORKSHEETS} 个工作表`);
  const sheet = options.sheetNames.map((name) => workbook.getWorksheet(name)).find((candidate) => candidate != null)
    ?? workbook.worksheets.find((candidate) => candidate.name !== '填报说明');
  if (!sheet) throw new ImportXlsxError('XLSX_DATA_SHEET_MISSING', `工作簿缺少“${options.sheetNames[0]}”数据工作表`);
  if (sheet.rowCount > maxRows + 1) throw new ImportXlsxError('XLSX_TOO_MANY_ROWS', `数据行超过 ${maxRows} 行上限`);
  if (sheet.columnCount > MAX_COLUMNS) throw new ImportXlsxError('XLSX_TOO_MANY_COLUMNS', `数据列超过 ${MAX_COLUMNS} 列上限`);
  if (sheet.rowCount < 2 || sheet.columnCount < 1) throw new ImportXlsxError('XLSX_NO_DATA_ROWS', '工作表至少需要一行表头和一行数据');

  const headerRow = sheet.getRow(1);
  const headers = Array.from({ length: sheet.columnCount }, (_, offset) => {
    const cell = headerRow.getCell(offset + 1);
    if (cell.type === ExcelJS.ValueType.Formula) throw new ImportXlsxError('XLSX_FORMULAS_NOT_ALLOWED', '表头不能使用公式');
    return cellText(cell).trim();
  });
  if (headers.some((header) => !header)) throw new ImportXlsxError('XLSX_HEADER_EMPTY', '数据工作表存在空表头，请修正后重试');
  const normalizedHeaders = headers.map(normalized);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new ImportXlsxError('XLSX_HEADER_DUPLICATE', '数据工作表存在重复表头，请为每列设置唯一名称');

  const rows: string[][] = [];
  const cellTypes: string[][] = [];
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values: string[] = [];
    const types: string[] = [];
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.Formula) throw new ImportXlsxError('XLSX_FORMULAS_NOT_ALLOWED', `第 ${rowNumber} 行第 ${column} 列包含公式；当前只接受静态值`);
      if (cell.type === ExcelJS.ValueType.Error) throw new ImportXlsxError('XLSX_CELL_ERROR', `第 ${rowNumber} 行第 ${column} 列包含 Excel 错误值`);
      values.push(cellText(cell));
      types.push(cellType(cell));
    }
    if (values.some((value) => value.trim() !== '')) { rows.push(values); cellTypes.push(types); }
  }
  if (rows.length === 0) throw new ImportXlsxError('XLSX_NO_DATA_ROWS', '数据工作表没有可导入的数据行');
  if (rows.length > maxRows) throw new ImportXlsxError('XLSX_TOO_MANY_ROWS', `数据行超过 ${maxRows} 行上限`);

  return { sheetName: sheet.name, headers, rows, cellTypes, rowCount: rows.length, maxRows };
}
