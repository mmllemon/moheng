import ExcelJS from 'exceljs';
import type { ReportSnapshot, ReportKey } from './report-data.js';
import { valueForJson } from './report-data.js';
import type { ReportTemplateDefinition, ReportTemplateColumn } from './report-template.js';

function safeCellValue(value: unknown): ExcelJS.CellValue {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object' && value.constructor?.name === 'Decimal') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : String(value);
  }
  return String(value);
}

function numberFormat(column: ReportTemplateColumn, sourceType: string | undefined): string {
  switch (column.format === 'auto' ? sourceType : column.format) {
    case 'text': return '@';
    case 'money': return '#,##0.00;[Red]-#,##0.00';
    case 'number': return '#,##0.###';
    case 'date': return 'yyyy-mm-dd';
    default: return 'General';
  }
}

function mergeCellRegions(worksheet: ExcelJS.Worksheet, definition: ReportTemplateDefinition, visibleSourceIndexes: number[], firstStaticRow: number) {
  for (const region of definition.merges) {
    const visibleWithin = visibleSourceIndexes
      .map((sourceCol, outputIndex) => ({ sourceCol, outputIndex }))
      .filter(({ sourceCol }) => sourceCol >= region.col && sourceCol < region.col + region.colSpan);
    if (visibleWithin.length === 0) continue;
    const startRow = firstStaticRow + region.row;
    const startCol = visibleWithin[0]!.outputIndex + 1;
    const endRow = startRow + region.rowSpan - 1;
    const endCol = startCol + visibleWithin.length - 1;
    if (endRow <= worksheet.rowCount && endCol <= visibleSourceIndexes.length && (region.rowSpan > 1 || visibleWithin.length > 1)) {
      worksheet.mergeCells(startRow, startCol, endRow, endCol);
    }
  }
}

function applyBorders(worksheet: ExcelJS.Worksheet, fromRow: number, toRow: number, toColumn: number) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = 1; column <= toColumn; column += 1) {
      worksheet.getCell(row, column).border = {
        top: { style: 'thin', color: { argb: 'FFD9E1EA' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E1EA' } },
        left: { style: 'thin', color: { argb: 'FFD9E1EA' } },
        right: { style: 'thin', color: { argb: 'FFD9E1EA' } },
      };
    }
  }
}

export interface ReportWorkbookOptions {
  snapshot: ReportSnapshot;
  definition: ReportTemplateDefinition;
  templateName: string;
  templateVersion: number;
}

export async function buildReportWorkbook(options: ReportWorkbookOptions): Promise<Buffer> {
  const { snapshot, definition } = options;
  const visibleSourceIndexes = definition.columns.map((column, index) => column.visible ? index : -1).filter((index) => index >= 0);
  if (visibleSourceIndexes.length === 0) throw new Error('REPORT_TEMPLATE_NO_VISIBLE_COLUMNS');
  const columns = visibleSourceIndexes.map((index) => definition.columns[index]!);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '墨衡工程经营管理系统';
  workbook.lastModifiedBy = '墨衡工程经营管理系统';
  workbook.created = snapshot.generatedAt;
  workbook.modified = snapshot.generatedAt;
  workbook.subject = snapshot.report.label;
  workbook.title = definition.title;
  workbook.company = '墨衡';
  workbook.properties.date1904 = false;

  const sheet = workbook.addWorksheet('数据', {
    views: [{ state: 'frozen', ySplit: 1 + (definition.subtitle ? 1 : 0) + definition.customRows.length + 1, xSplit: 0 }],
    pageSetup: {
      paperSize: definition.page.paper === 'A3' ? 8 : definition.page.paper === 'Letter' ? 1 : 9,
      orientation: definition.page.orientation,
      fitToPage: definition.page.fitToWidth,
      fitToWidth: definition.page.fitToWidth ? 1 : 0,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    },
  });
  sheet.properties.defaultRowHeight = definition.rowHeights.body;
  sheet.pageSetup.horizontalCentered = false;
  sheet.pageSetup.verticalCentered = false;
  if (definition.page.repeatHeader) sheet.pageSetup.printTitlesRow = `${1 + (definition.subtitle ? 1 : 0) + definition.customRows.length + 1}:${1 + (definition.subtitle ? 1 : 0) + definition.customRows.length + 1}`;
  if (definition.page.showPageNumber) sheet.headerFooter.oddFooter = `&L${definition.page.footerText.replace(/&/g, '&&')}&R第 &P 页 / 共 &N 页`;
  else sheet.headerFooter.oddFooter = `&L${definition.page.footerText.replace(/&/g, '&&')}`;
  sheet.headerFooter.oddHeader = `&C${definition.title.replace(/[&]/g, '&&')}`;

  columns.forEach((column, index) => {
    sheet.getColumn(index + 1).width = column.width;
    sheet.getColumn(index + 1).hidden = false;
  });
  let nextRow = 1;
  sheet.getCell(nextRow, 1).value = definition.title;
  if (columns.length > 1) sheet.mergeCells(nextRow, 1, nextRow, columns.length);
  sheet.getRow(nextRow).height = definition.rowHeights.title;
  sheet.getRow(nextRow).font = { name: 'Microsoft YaHei', size: 16, bold: true, color: { argb: 'FF102A43' } };
  sheet.getRow(nextRow).alignment = { vertical: 'middle', horizontal: 'center' };
  nextRow += 1;

  if (definition.subtitle) {
    const subtitle = definition.subtitle
      .replaceAll('{project}', snapshot.projectScope)
      .replaceAll('{generatedAt}', snapshot.generatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }))
      .replaceAll('{rowCount}', String(snapshot.rowCount));
    sheet.getCell(nextRow, 1).value = subtitle;
    if (columns.length > 1) sheet.mergeCells(nextRow, 1, nextRow, columns.length);
    sheet.getRow(nextRow).height = definition.rowHeights.subtitle;
    sheet.getRow(nextRow).font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF536579' } };
    sheet.getRow(nextRow).alignment = { vertical: 'middle', horizontal: 'left' };
    nextRow += 1;
  }

  const firstStaticRow = nextRow;
  definition.customRows.forEach((customRow) => {
    columns.forEach((column, outputIndex) => {
      const sourceCol = visibleSourceIndexes[outputIndex]!;
      sheet.getCell(nextRow, outputIndex + 1).value = customRow.cells[sourceCol] ?? '';
      sheet.getCell(nextRow, outputIndex + 1).alignment = { vertical: 'middle', horizontal: column.align, wrapText: true };
      sheet.getCell(nextRow, outputIndex + 1).font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF334155' } };
    });
    sheet.getRow(nextRow).height = customRow.height;
    nextRow += 1;
  });
  if (definition.customRows.length > 0) mergeCellRegions(sheet, definition, visibleSourceIndexes, firstStaticRow);

  const headerRow = nextRow;
  columns.forEach((column, index) => {
    const cell = sheet.getCell(headerRow, index + 1);
    cell.value = column.label;
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
    cell.alignment = { vertical: 'middle', horizontal: column.align, wrapText: true };
  });
  sheet.getRow(headerRow).height = definition.rowHeights.header;
  nextRow += 1;

  const sourceFieldMap = new Map(snapshot.fields.map((field, index) => [field.key, { index, field }]));
  snapshot.rows.forEach((dataRow) => {
    columns.forEach((column, outputIndex) => {
      const cell = sheet.getCell(nextRow, outputIndex + 1);
      const source = column.fieldKey ? sourceFieldMap.get(column.fieldKey) : undefined;
      const value = source ? dataRow[source.index] : column.staticValue;
      cell.value = safeCellValue(value);
      cell.numFmt = numberFormat(column, source?.field.type);
      cell.alignment = { vertical: 'middle', horizontal: column.align, wrapText: true };
      cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: 'FF243B53' } };
    });
    if (nextRow % 2 === 1) {
      for (let col = 1; col <= columns.length; col += 1) sheet.getCell(nextRow, col).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7FAFC' } };
    }
    sheet.getRow(nextRow).height = definition.rowHeights.body;
    nextRow += 1;
  });
  applyBorders(sheet, headerRow, Math.max(headerRow, nextRow - 1), columns.length);
  sheet.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(headerRow, nextRow - 1), column: columns.length } };
  sheet.views = [{ state: 'frozen', ySplit: headerRow, xSplit: 0 }];
  sheet.pageSetup.printArea = `A1:${sheet.getColumn(columns.length).letter}${Math.max(headerRow, nextRow - 1)}`;
  if (snapshot.truncated) {
    const note = sheet.getCell(nextRow + 1, 1);
    note.value = '提示：本次数据达到导出上限，文件可能未包含全部符合条件的记录。请缩小筛选范围后分批导出。';
    note.font = { name: 'Microsoft YaHei', size: 9, bold: true, color: { argb: 'FF9A3412' } };
    if (columns.length > 1) sheet.mergeCells(nextRow + 1, 1, nextRow + 1, columns.length);
  }

  if (definition.page.includeDescription) {
  const info = workbook.addWorksheet('导出说明');
  info.columns = [{ width: 24 }, { width: 74 }];
  info.addRow(['项目', '内容']);
  info.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  info.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF244E72' } };
  const infoRows: Array<[string, string]> = [
    ['报表名称', snapshot.report.label], ['模板标题', definition.title], ['模板名称', options.templateName], ['模板版本', String(options.templateVersion)],
    ['数据范围', snapshot.projectScope], ['开始日期', snapshot.filters.from ?? '不限'], ['结束日期', snapshot.filters.to ?? '不限'],
    ['生成时间', snapshot.generatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })],
    ['记录条数', String(snapshot.rowCount)], ['导出上限', String(snapshot.report.rowLimit)], ['是否截断', snapshot.truncated ? '是' : '否'],
    ['说明', '本工作簿是墨衡服务端按当前登录账号和项目权限查询生成的数据快照；修改本文件不会回写墨衡业务数据。'],
    ['金额口径', '金额、合同调整和资金数据以墨衡正式业务台账为准；本工作簿不重新计算业务金额。'],
  ];
  infoRows.forEach((row) => info.addRow(row));
  info.eachRow((row) => { row.height = 23; row.alignment = { vertical: 'middle', wrapText: true }; });
  info.getColumn(1).font = { bold: true, color: { argb: 'FF334155' } };
  applyBorders(info, 1, info.rowCount, 2);
  info.views = [{ state: 'frozen', ySplit: 1 }];
  }

  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}

export function reportRowToJson(row: unknown[]): unknown[] {
  return row.map(valueForJson);
}

export function reportKeyToFilename(reportKey: ReportKey): string {
  return reportKey.replace(/[^a-z0-9-]/gi, '-');
}
