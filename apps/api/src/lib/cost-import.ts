import { ImportXlsxError, type ImportColumn, type ImportTemplateSpec } from './tabular-import.js';

/**
 * 实际成本导入：列定义 + 纯行解析。
 *
 * 与目标成本清单不同，成本行的关联项（清单编号、分供合同编号、往来单位名称）
 * 需要查库解析成 ID，所以这里只做「与数据库无关」的那一半：表头定位、日期、类型、
 * 数值与必填校验。ID 解析与写入放在路由层，保证这里可被单测覆盖。
 */

export const COST_IMPORT_SHEET = '实际成本';

export const COST_IMPORT_COLUMNS: ImportColumn[] = [
  { header: '日期', width: 14, numFmt: 'yyyy-mm-dd' },
  { header: '类型', width: 12 },
  { header: '费用说明', width: 34 },
  { header: '金额(元)', width: 16, numFmt: '#,##0.00' },
  { header: '税额(元)', width: 14, numFmt: '#,##0.00' },
  { header: '关联清单编号', width: 18, numFmt: '@' },
  { header: '分供合同编号', width: 20, numFmt: '@' },
  { header: '往来单位', width: 24 },
  { header: '数量', width: 14, numFmt: '#,##0.###' },
  { header: '单位', width: 10 },
  { header: '单价(元)', width: 16, numFmt: '#,##0.0000' },
  { header: '发票号', width: 18, numFmt: '@' },
  { header: '班组', width: 18 },
  { header: '备注', width: 30 },
];

export const COST_IMPORT_TEMPLATE: ImportTemplateSpec = {
  sheetName: COST_IMPORT_SHEET,
  columns: COST_IMPORT_COLUMNS,
  instructions: [
    ['用途', '本工作簿用于批量导入墨衡项目的实际成本记录。请保留“实际成本”工作表的第一行表头。'],
    ['日期', '必填，格式 2026-10-31 或 2026/10/31；系统按发生日期入账。'],
    ['类型', '必填，可填中文（人工 / 材料 / 机械 / 分包 / 间接费用）或枚举名（LABOR / MATERIAL / MACHINE / SUBCONTRACT / INDIRECT）。'],
    ['费用说明', '必填，最多 240 字，写清这笔钱花在什么上。'],
    ['金额(元)', '必填，非负数。金额口径与页面录入一致，不自动拆分税额。'],
    ['税额(元)', '可空；填写时作为记录字段保存，不参与金额运算。'],
    ['关联清单编号', '可空；填目标成本清单里的“清单编号”，必须属于当前项目。'],
    ['分供合同编号', '可空；填分供合同编号。草稿或已终止合同不接受导入，需先在系统内处理合同状态。'],
    ['往来单位', '可空；按单位全称精确匹配。同时填分供合同时，单位必须是该合同的相对方。'],
    ['数量 / 单位 / 单价', '可空但必须是非负数；三者不参与金额计算，仅作记录与核对。'],
    ['发票号 / 班组 / 备注', '可空，纯记录字段。'],
    ['整批与冲突', `本次最多 5,000 行。任何一行校验失败都不导入，先在预览里改正整批再提交。`],
    ['安全边界', '上传文件仅用于读取数据；正式写入由服务端权限、校验与单事务控制，修改已导出的工作簿不会回写系统。'],
  ],
};

const TYPE_LABELS: Record<string, string> = {
  人工: 'LABOR', 人工费: 'LABOR',
  材料: 'MATERIAL', 材料费: 'MATERIAL',
  机械: 'MACHINE', 机械费: 'MACHINE',
  分包: 'SUBCONTRACT', 分包费: 'SUBCONTRACT',
  间接费用: 'INDIRECT', 间接费: 'INDIRECT', 其他: 'INDIRECT',
  LABOR: 'LABOR', MATERIAL: 'MATERIAL', MACHINE: 'MACHINE', SUBCONTRACT: 'SUBCONTRACT', INDIRECT: 'INDIRECT',
};

const HEADER_ALIASES: Record<string, string> = {
  日期: 'date', 发生日期: 'date',
  类型: 'type', 成本类型: 'type',
  费用说明: 'description', 说明: 'description',
  金额: 'amount', 金额元: 'amount', 发生金额: 'amount',
  税额: 'taxAmount', 税额元: 'taxAmount',
  关联清单编号: 'budgetItemCode', 清单编号: 'budgetItemCode',
  分供合同编号: 'contractNo', 合同编号: 'contractNo',
  往来单位: 'partyName', 供应商: 'partyName', 班组名称: 'partyName',
  数量: 'quantity',
  单位: 'unit',
  单价: 'unitPrice', 单价元: 'unitPrice',
  发票号: 'invoiceNo',
  班组: 'teamName',
  备注: 'notes',
};

export type ParsedCostRowData = {
  date: string;
  type: string;
  description: string;
  amount: number;
  taxAmount: number | null;
  budgetItemCode: string | null;
  contractNo: string | null;
  partyName: string | null;
  quantity: number | null;
  unit: string | null;
  unitPrice: number | null;
  invoiceNo: string | null;
  teamName: string | null;
  notes: string | null;
};

export type ParsedCostRow = {
  rowNumber: number;
  valid: boolean;
  errors: string[];
  data?: ParsedCostRowData;
};

const normalizeHeader = (value: string) => value.replace(/[\s_（）()]/g, '').toLocaleLowerCase();

function parseDate(value: string): string | null {
  const text = value.trim().replace(/\//g, '-');
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseNumber(value: string, precision = 2): number | null {
  const text = value.replace(/[,，\s]/g, '').replace(/[¥￥元]/g, '');
  if (!text) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return null;
  const factor = 10 ** precision;
  return Math.round(parsed * factor) / factor;
}

/** 按表头建立「字段 → 列下标」。未知表头直接忽略，缺必填列时报一次整体错。 */
export function mapCostImportHeaders(headers: string[]): { index: Partial<Record<keyof ParsedCostRowData, number>>; missing: string[]; unknown: string[] } {
  const index: Partial<Record<keyof ParsedCostRowData, number>> = {};
  const unknown: string[] = [];
  headers.forEach((header, column) => {
    const field = HEADER_ALIASES[normalizeHeader(header)] as keyof ParsedCostRowData | undefined;
    if (field && index[field] === undefined) index[field] = column;
    else if (!field) unknown.push(header);
  });
  const missing: string[] = [];
  if (index.date === undefined) missing.push('日期');
  if (index.type === undefined) missing.push('类型');
  if (index.description === undefined) missing.push('费用说明');
  if (index.amount === undefined) missing.push('金额(元)');
  return { index, missing, unknown };
}

export function parseCostImportRows(headers: string[], rows: string[][]): { rows: ParsedCostRow[]; missingColumns: string[]; unknownColumns: string[] } {
  const { index, missing, unknown } = mapCostImportHeaders(headers);
  if (missing.length) return { rows: [], missingColumns: missing, unknownColumns: unknown };
  const cell = (values: string[], field: keyof ParsedCostRowData) => {
    const column = index[field];
    return column === undefined ? '' : (values[column] ?? '').trim();
  };

  const parsed = rows.map((values, offset) => {
    const errors: string[] = [];
    const rawDate = cell(values, 'date');
    const date = parseDate(rawDate);
    if (!rawDate) errors.push('日期不能为空');
    else if (!date) errors.push(`日期“${rawDate}”无法识别，请用 2026-10-31 这种格式`);

    const rawType = cell(values, 'type');
    const type = rawType ? TYPE_LABELS[rawType.toUpperCase()] ?? TYPE_LABELS[rawType] : undefined;
    if (!rawType) errors.push('类型不能为空');
    else if (!type) errors.push(`类型“${rawType}”不在允许范围（人工/材料/机械/分包/间接费用）`);

    const description = cell(values, 'description');
    if (!description) errors.push('费用说明不能为空');
    else if (description.length > 240) errors.push('费用说明超过 240 字');

    const rawAmount = cell(values, 'amount');
    const amount = parseNumber(rawAmount, 2);
    if (!rawAmount) errors.push('金额不能为空');
    else if (amount == null) errors.push(`金额“${rawAmount}”不是有效数字`);
    else if (amount <= 0) errors.push('金额必须大于 0');

    const rawTax = cell(values, 'taxAmount');
    const taxAmount = rawTax ? parseNumber(rawTax, 2) : null;
    if (rawTax && taxAmount == null) errors.push(`税额“${rawTax}”不是有效数字`);
    if (taxAmount != null && taxAmount < 0) errors.push('税额不能为负数');

    const rawQuantity = cell(values, 'quantity');
    const quantity = rawQuantity ? parseNumber(rawQuantity, 4) : null;
    if (rawQuantity && quantity == null) errors.push(`数量“${rawQuantity}”不是有效数字`);
    if (quantity != null && quantity < 0) errors.push('数量不能为负数');

    const rawUnitPrice = cell(values, 'unitPrice');
    const unitPrice = rawUnitPrice ? parseNumber(rawUnitPrice, 4) : null;
    if (rawUnitPrice && unitPrice == null) errors.push(`单价“${rawUnitPrice}”不是有效数字`);
    if (unitPrice != null && unitPrice < 0) errors.push('单价不能为负数');

    const row: ParsedCostRow = {
      rowNumber: offset + 2,
      valid: errors.length === 0,
      errors,
      ...(errors.length === 0 ? {
        data: {
          date: date as string,
          type: type as string,
          description,
          amount: amount as number,
          taxAmount,
          budgetItemCode: cell(values, 'budgetItemCode') || null,
          contractNo: cell(values, 'contractNo') || null,
          partyName: cell(values, 'partyName') || null,
          quantity,
          unit: cell(values, 'unit') || null,
          unitPrice,
          invoiceNo: cell(values, 'invoiceNo') || null,
          teamName: cell(values, 'teamName') || null,
          notes: cell(values, 'notes') || null,
        },
      } : {}),
    };
    return row;
  });

  return { rows: parsed, missingColumns: [], unknownColumns: unknown };
}

export function assertImportable(rows: ParsedCostRow[]): void {
  const invalid = rows.filter((row) => !row.valid);
  if (invalid.length) throw new ImportXlsxError('IMPORT_ROWS_INVALID', `有 ${invalid.length} 行未通过校验，整批未导入`);
}
