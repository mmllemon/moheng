import ExcelJS from 'exceljs';

export const BUDGET_XLSX_MAX_BYTES = 8 * 1024 * 1024;
export const BUDGET_XLSX_MAX_ROWS = 5000;
const MAX_WORKSHEETS = 10;
const MAX_COLUMNS = 40;
const MAX_ZIP_ENTRIES = 128;
const MAX_UNCOMPRESSED_BYTES = 40 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 16 * 1024 * 1024;
const normalized = (value: string) => value.replace(/[\s_（）()]/g, '').toLocaleLowerCase();

export class BudgetXlsxError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = 'BudgetXlsxError'; }
}

export interface BudgetXlsxInspection {
  sheetName: string;
  headers: string[];
  rows: string[][];
  cellTypes: string[][];
}

function preflightZip(buffer: Buffer): void {
  const minimumEocd = 22;
  const eocdSearchStart = Math.max(0, buffer.length - 22 - 0xffff);
  let eocd = -1;
  for (let offset = buffer.length - minimumEocd; offset >= eocdSearchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new BudgetXlsxError('XLSX_CONTAINER_INVALID', '文件缺少有效的 ZIP 中央目录，可能并非完整工作簿');
  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entries = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (eocd + minimumEocd + commentLength !== buffer.length) throw new BudgetXlsxError('XLSX_ZIP_STRUCTURE_INVALID', '工作簿 ZIP 结束记录或注释长度无效');
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entries) throw new BudgetXlsxError('XLSX_MULTIDISK_UNSUPPORTED', '不接受分卷 ZIP 工作簿，请另存为普通 .xlsx');
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new BudgetXlsxError('XLSX_ZIP64_UNSUPPORTED', '不接受 ZIP64 超大工作簿；请另存为普通 .xlsx');
  }
  if (entries < 1 || entries > MAX_ZIP_ENTRIES || centralOffset + centralSize !== eocd || centralOffset < 0) {
    throw new BudgetXlsxError('XLSX_ZIP_STRUCTURE_INVALID', `工作簿 ZIP 结构无效或文件项超过 ${MAX_ZIP_ENTRIES} 个`);
  }
  let offset = centralOffset;
  let uncompressedTotal = 0;
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new BudgetXlsxError('XLSX_ZIP_STRUCTURE_INVALID', '工作簿 ZIP 中央目录记录无效');
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
      throw new BudgetXlsxError('XLSX_ZIP64_UNSUPPORTED', '不接受 ZIP64 超大工作簿；请另存为普通 .xlsx');
    }
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (nameLength < 1 || entryEnd > centralOffset + centralSize) throw new BudgetXlsxError('XLSX_ZIP_STRUCTURE_INVALID', '工作簿 ZIP 文件项边界无效');
    if ((flags & 0x1) !== 0) throw new BudgetXlsxError('XLSX_ZIP_ENCRYPTED', '不接受加密工作簿，请先在 Excel/WPS 中解密后另存为 .xlsx');
    if (uncompressedSize > MAX_ZIP_ENTRY_BYTES) throw new BudgetXlsxError('XLSX_ZIP_ENTRY_TOO_LARGE', '工作簿包含单个过大的内容文件');
    uncompressedTotal += uncompressedSize;
    if (uncompressedTotal > MAX_UNCOMPRESSED_BYTES) throw new BudgetXlsxError('XLSX_ZIP_EXPANSION_TOO_LARGE', '工作簿解压后的内容超过 40 MB 安全上限');
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength).replaceAll('\\', '/');
    if (name.startsWith('/') || name.split('/').includes('..')) throw new BudgetXlsxError('XLSX_ZIP_PATH_INVALID', '工作簿包含不安全的 ZIP 文件路径');
    if (/(?:externalLinks|embeddings|vbaProject\.bin|connections\.xml|queryTables|pivotCache)/i.test(name)) {
      throw new BudgetXlsxError('XLSX_EXTERNAL_CONTENT_UNSUPPORTED', '第一版不接受含外部链接、宏、嵌入对象或外部数据连接的工作簿');
    }
    offset = entryEnd;
  }
  if (offset !== centralOffset + centralSize) throw new BudgetXlsxError('XLSX_ZIP_STRUCTURE_INVALID', '工作簿 ZIP 中央目录长度不匹配');
}

export function decodeBudgetXlsx(filename: unknown, base64: unknown): Buffer {
  if (typeof filename !== 'string' || !filename.toLocaleLowerCase().endsWith('.xlsx')) {
    throw new BudgetXlsxError('XLSX_FILE_TYPE_INVALID', '仅接受 .xlsx 文件；.xls、.xlsm 和其他格式不受支持');
  }
  if (typeof base64 !== 'string' || base64.length === 0) throw new BudgetXlsxError('XLSX_FILE_REQUIRED', '未收到有效的 XLSX 文件内容');
  if (base64.length > Math.ceil(BUDGET_XLSX_MAX_BYTES * 4 / 3) + 8) throw new BudgetXlsxError('XLSX_FILE_TOO_LARGE', 'XLSX 文件不能超过 8 MB');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new BudgetXlsxError('XLSX_BASE64_INVALID', '文件编码不正确，请重新选择文件');
  }
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length || buffer.length > BUDGET_XLSX_MAX_BYTES) throw new BudgetXlsxError('XLSX_FILE_TOO_LARGE', 'XLSX 文件为空或超过 8 MB');
  if (buffer[0] !== 0x50 || buffer[1] !== 0x4b) throw new BudgetXlsxError('XLSX_CONTAINER_INVALID', '文件不是有效的 XLSX/ZIP 工作簿');
  preflightZip(buffer);
  return buffer;
}

export async function buildBudgetImportTemplate(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '墨衡工程经营管理系统';
  workbook.created = new Date();
  workbook.subject = '目标成本清单导入模板';
  workbook.title = '墨衡目标成本清单导入模板';
  const sheet = workbook.addWorksheet('目标成本清单', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { paperSize: 9, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [
    { header: '清单编号', key: 'code', width: 18, style: { numFmt: '@' } },
    { header: '清单名称', key: 'name', width: 34 },
    { header: '上级清单编号', key: 'parentId', width: 18, style: { numFmt: '@' } },
    { header: '单位', key: 'unit', width: 12 },
    { header: '工程量', key: 'quantity', width: 16, style: { numFmt: '#,##0.###' } },
    { header: '综合单价(元)', key: 'unitPrice', width: 18, style: { numFmt: '#,##0.0000' } },
    { header: '目标合价(元)', key: 'totalPrice', width: 18, style: { numFmt: '#,##0.00' } },
    { header: '排序值', key: 'sortOrder', width: 12, style: { numFmt: '0' } },
  ];
  const header = sheet.getRow(1);
  header.height = 30;
  header.font = { name: 'Microsoft YaHei', bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
  header.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  header.eachCell((cell) => { cell.border = { bottom: { style: 'medium', color: { argb: 'FF163A59' } } }; });
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: 8 } };
  sheet.getColumn(1).numFmt = '@';
  sheet.getColumn(3).numFmt = '@';
  const instructions = workbook.addWorksheet('填报说明');
  instructions.columns = [{ width: 24 }, { width: 100 }];
  instructions.addRow(['项目', '说明']);
  const rows: Array<[string, string]> = [
    ['用途', '本工作簿用于导入墨衡项目的目标成本清单。请保留“目标成本清单”工作表的第一行表头。'],
    ['清单编号', '必填，必须设置为文本格式，保留前导零；同一项目内编号不能重复。'],
    ['清单名称', '必填，填写可识别的清单名称。'],
    ['上级清单编号', '可空；填写父级清单编号。父级应位于子级之前，或已存在于当前项目。不要填写其他项目的数据库 ID。'],
    ['工程量 / 综合单价', '可空但必须是非负数。系统根据当前业务规则保存输入精度。'],
    ['目标合价', '可空；为空时由系统按工程量 × 单价计算。填写后作为手工目标合价，系统不会静默覆盖。'],
    ['排序值', '可空，系统按导入顺序提供默认排序。'],
    ['工作表与公式', '第一版只导入“目标成本清单”工作表的静态值，不接受公式、宏、外部链接或嵌入对象。'],
    ['层级与冲突', '本次最多 5,000 条。编号重复、父级无法匹配、数值不合法或任何一行校验失败，整批不导入。'],
    ['安全边界', '上传文件仅用于读取清单数据。正式写入由墨衡服务端权限、校验和单事务控制；修改已导出的工作簿不会回写系统。'],
  ];
  rows.forEach((row) => instructions.addRow(row));
  instructions.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  instructions.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
  instructions.eachRow((row) => { row.height = 28; row.alignment = { vertical: 'middle', wrapText: true }; row.eachCell((cell) => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFD9E1EA' } } }; }); });
  instructions.getColumn(1).font = { bold: true, color: { argb: 'FF334155' } };
  const data = await workbook.xlsx.writeBuffer();
  return Buffer.from(data);
}

function getCellType(cell: ExcelJS.Cell): string {
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

export async function inspectBudgetImportWorkbook(buffer: Buffer): Promise<BudgetXlsxInspection> {
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]); }
  catch { throw new BudgetXlsxError('XLSX_WORKBOOK_INVALID', '无法解析工作簿，请用 Excel 或 WPS 重新另存为 .xlsx 后重试'); }
  if (workbook.worksheets.length > MAX_WORKSHEETS) throw new BudgetXlsxError('XLSX_TOO_MANY_SHEETS', `工作簿最多允许 ${MAX_WORKSHEETS} 个工作表`);
  const worksheet = workbook.getWorksheet('目标成本清单') ?? workbook.worksheets.find((sheet) => sheet.name !== '填报说明');
  if (!worksheet) throw new BudgetXlsxError('XLSX_DATA_SHEET_MISSING', '工作簿缺少“目标成本清单”数据工作表');
  if (worksheet.rowCount > BUDGET_XLSX_MAX_ROWS + 1) throw new BudgetXlsxError('XLSX_TOO_MANY_ROWS', `数据行超过 ${BUDGET_XLSX_MAX_ROWS} 行上限`);
  if (worksheet.columnCount > MAX_COLUMNS) throw new BudgetXlsxError('XLSX_TOO_MANY_COLUMNS', `数据列超过 ${MAX_COLUMNS} 列上限`);
  if (worksheet.rowCount < 2 || worksheet.columnCount < 1) throw new BudgetXlsxError('XLSX_NO_DATA_ROWS', '工作表至少需要一行表头和一行数据');
  const headerRow = worksheet.getRow(1);
  const headers = Array.from({ length: worksheet.columnCount }, (_, offset) => {
    const cell = headerRow.getCell(offset + 1);
    if (cell.type === ExcelJS.ValueType.Formula) throw new BudgetXlsxError('XLSX_FORMULAS_NOT_ALLOWED', '表头不能使用公式');
    return cellText(cell).trim();
  });
  if (headers.some((header) => !header)) throw new BudgetXlsxError('XLSX_HEADER_EMPTY', '数据工作表存在空表头，请修正后重试');
  const normalizedHeaders = headers.map(normalized);
  if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new BudgetXlsxError('XLSX_HEADER_DUPLICATE', '数据工作表存在重复表头，请为每列设置唯一名称');

  const rows: string[][] = [];
  const cellTypes: string[][] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values: string[] = [];
    const types: string[] = [];
    for (let column = 1; column <= worksheet.columnCount; column += 1) {
      const cell = row.getCell(column);
      if (cell.type === ExcelJS.ValueType.Formula) throw new BudgetXlsxError('XLSX_FORMULAS_NOT_ALLOWED', `第 ${rowNumber} 行第 ${column} 列包含公式；第一版只接受静态值`);
      if (cell.type === ExcelJS.ValueType.Error) throw new BudgetXlsxError('XLSX_CELL_ERROR', `第 ${rowNumber} 行第 ${column} 列包含 Excel 错误值`);
      values.push(cellText(cell));
      types.push(getCellType(cell));
    }
    if (values.some((value) => value.trim() !== '')) { rows.push(values); cellTypes.push(types); }
  }
  if (rows.length === 0) throw new BudgetXlsxError('XLSX_NO_DATA_ROWS', '数据工作表没有可导入的数据行');
  if (rows.length > BUDGET_XLSX_MAX_ROWS) throw new BudgetXlsxError('XLSX_TOO_MANY_ROWS', `数据行超过 ${BUDGET_XLSX_MAX_ROWS} 行上限`);
  return { sheetName: worksheet.name, headers, rows, cellTypes };
}
