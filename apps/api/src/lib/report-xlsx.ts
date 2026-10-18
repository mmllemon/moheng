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

function addStandardReportOverview(workbook: ExcelJS.Workbook, options: ReportWorkbookOptions, visibleColumnCount: number): void {
  const { snapshot, definition, templateName, templateVersion } = options;
  const sheet = workbook.addWorksheet('报表预览');
  sheet.columns = [{ width: 18 }, { width: 36 }, { width: 18 }, { width: 36 }];
  sheet.views = [{ state: 'normal', zoomScale: 90 }];
  sheet.properties.defaultRowHeight = 23;
  sheet.pageSetup = {
    paperSize: (definition.page.paper === 'A3' ? 8 : definition.page.paper === 'Letter' ? 1 : 9) as unknown as ExcelJS.PaperSize,
    orientation: 'portrait',
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.35, right: 0.35, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
  };
  sheet.headerFooter.oddFooter = '墨衡 · 报表导出摘要　&P/&N';

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = definition.title || snapshot.report.label;
  sheet.getCell('A1').font = { name: 'Microsoft YaHei', size: 20, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17324D' } };
  sheet.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  sheet.getRow(1).height = 42;

  sheet.mergeCells('A2:D2');
  sheet.getCell('A2').value = '墨衡 · 报表导出总览';
  sheet.getCell('A2').font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF35536D' } };
  sheet.getCell('A2').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F7' } };
  sheet.getCell('A2').alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(2).height = 26;

  const generatedAt = snapshot.generatedAt.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  sheet.getRow(4).values = ['报表类型', snapshot.report.label, '报表编号', snapshot.report.key];
  sheet.getRow(5).values = ['模板名称', templateName, '模板版本', `v${templateVersion}`];
  sheet.getRow(6).values = ['数据范围', snapshot.projectScope || '当前授权数据范围', '生成时间', generatedAt];
  sheet.getRow(7).values = ['开始日期', snapshot.filters.from ?? '不限', '结束日期', snapshot.filters.to ?? '不限'];
  sheet.getRow(8).values = ['导出行数', snapshot.rows.length, '导出上限', snapshot.report.rowLimit];
  sheet.getRow(9).values = ['数据完整性', snapshot.truncated ? '达到导出上限，详见提示' : '未触发导出截断', '可见字段数', visibleColumnCount];
  sheet.getRow(10).values = ['文件用途', '只读数据快照', '业务写入', '不会回写业务台账'];
  for (let rowIndex = 4; rowIndex <= 10; rowIndex += 1) {
    const row = sheet.getRow(rowIndex);
    row.height = rowIndex === 6 || rowIndex === 9 ? 31 : 26;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFE0E6ED' } } };
      if (columnNumber === 1 || columnNumber === 3) {
        cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF29465F' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F5F8' } };
      } else {
        cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF253746' } };
      }
    });
  }

  sheet.mergeCells('A12:D12');
  sheet.getCell('A12').value = '工作表目录';
  sheet.getCell('A12').font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell('A12').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF35536D' } };
  sheet.getCell('A12').alignment = { vertical: 'middle', indent: 1 };
  sheet.getRow(12).height = 26;
  sheet.getRow(13).values = ['序号', '工作表名称', '导出记录数', '备注'];
  sheet.getRow(13).eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { name: 'Microsoft YaHei', size: 10, bold: true, color: { argb: 'FF29465F' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEAF1F7' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCAD5DF' } } };
  });
  const directory = [
    ['数据', snapshot.rows.length, snapshot.truncated ? '部分数据受导出上限约束' : '业务数据明细'],
    ...(definition.page.includeDescription ? [['导出说明', 12, '范围、口径与生成元数据']] : []),
  ] as Array<[string, number, string]>;
  directory.forEach(([name, count, note], index) => {
    const row = sheet.addRow([index + 1, name, count, note]);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Microsoft YaHei', size: 10, color: { argb: 'FF253746' } };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E6ED' } } };
    });
  });

  const noteHeader = 15 + directory.length;
  sheet.mergeCells(`A${noteHeader}:D${noteHeader}`);
  sheet.getCell(`A${noteHeader}`).value = '阅读说明';
  sheet.getCell(`A${noteHeader}`).font = { name: 'Microsoft YaHei', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getCell(`A${noteHeader}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF35536D' } };
  sheet.getCell(`A${noteHeader}`).alignment = { vertical: 'middle', indent: 1 };
  const notes = [
    '本工作簿是生成时点的只读快照；修改 Excel 文件不会回写墨衡业务台账。',
    '数据范围受当前登录账号、项目权限与筛选条件约束。',
    '金额和合同调整口径以墨衡正式业务台账为准；报表导出不重新计算业务金额。',
    ...(snapshot.truncated ? ['本次结果达到导出上限，文件可能未包含全部符合筛选条件的记录；请缩小范围或分批导出。'] : []),
  ];
  notes.forEach((note, index) => {
    const rowNumber = noteHeader + index + 1;
    sheet.mergeCells(`A${rowNumber}:D${rowNumber}`);
    const cell = sheet.getCell(`A${rowNumber}`);
    cell.value = note;
    cell.font = { name: 'Microsoft YaHei', size: 9, color: { argb: snapshot.truncated && note.startsWith('本次结果') ? 'FF9A3412' : 'FF536575' } };
    cell.alignment = { vertical: 'middle', wrapText: true };
    cell.border = { bottom: { style: 'hair', color: { argb: 'FFE0E6ED' } } };
    sheet.getRow(rowNumber).height = 30;
  });
  sheet.pageSetup.printArea = `A1:D${noteHeader + notes.length}`;
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
  addStandardReportOverview(workbook, options, columns.length);

  const sheet = workbook.addWorksheet('数据', {
    views: [{ state: 'frozen', ySplit: 1 + (definition.subtitle ? 1 : 0) + definition.customRows.length + 1, xSplit: 0 }],
    pageSetup: {
      // ExcelJS currently omits valid SpreadsheetML paper codes 1 (Letter) and 8 (A3) from its PaperSize union.
      paperSize: (definition.page.paper === 'A3' ? 8 : definition.page.paper === 'Letter' ? 1 : 9) as unknown as ExcelJS.PaperSize,
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
