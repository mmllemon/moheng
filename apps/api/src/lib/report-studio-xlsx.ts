import ExcelJS from 'exceljs';
import type { ReportStudioDefinition } from './report-studio-definition.js';
import type { ReportStudioDataset } from './report-studio-data.js';
import { renderReportStudio } from './report-studio-render.js';

function colorArgb(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const hex = value.replace(/^#/, '');
    if (/^[0-9a-fA-F]{6}$/.test(hex)) return `FF${hex.toUpperCase()}`;
    if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.toUpperCase();
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const item = value as Record<string, unknown>;
    if (typeof item.rgb === 'string') return colorArgb(item.rgb);
    if (typeof item.rrggbb === 'string') return colorArgb(item.rrggbb);
  }
  return undefined;
}
function borderStyle(value: unknown): ExcelJS.BorderStyle | undefined {
  const lookup: Record<string, ExcelJS.BorderStyle> = { 1: 'thin', 2: 'hair', 3: 'dotted', 4: 'dashed', 5: 'dashDot', 6: 'dashDotDot', 7: 'double', 8: 'medium', 9: 'mediumDashed', 10: 'mediumDashDot', 11: 'mediumDashDotDot', 12: 'slantDashDot', 13: 'thick', thin: 'thin', hair: 'hair', medium: 'medium', thick: 'thick', dashed: 'dashed', dotted: 'dotted', double: 'double' };
  if (typeof value === 'number' || typeof value === 'string') return lookup[String(value)];
  return undefined;
}
function styleToExcel(style?: Record<string, unknown>): Partial<ExcelJS.Style> | undefined {
  if (!style) return undefined;
  const result: Partial<ExcelJS.Style> = {};
  const font: ExcelJS.Font = {};
  if (typeof style.ff === 'string') font.name = style.ff.slice(0, 80);
  if (typeof style.fs === 'number') font.size = Math.min(96, Math.max(6, style.fs));
  if (typeof style.bl === 'boolean' || typeof style.bl === 'number') font.bold = style.bl === true || style.bl === 1;
  if (typeof style.it === 'boolean' || typeof style.it === 'number') font.italic = style.it === true || style.it === 1;
  if (style.ul === true || style.ul === 1) font.underline = true;
  if (style.st === true || style.st === 1) font.strike = true;
  const fontColor = colorArgb(style.cl);
  if (fontColor) font.color = { argb: fontColor };
  if (Object.keys(font).length) result.font = font;
  const fillColor = colorArgb(style.bg);
  if (fillColor) result.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
  const horizontalMap: Record<string, ExcelJS.Alignment['horizontal']> = { 1: 'left', 2: 'center', 3: 'right', left: 'left', center: 'center', right: 'right' };
  const verticalMap: Record<string, ExcelJS.Alignment['vertical']> = { 1: 'middle', 2: 'top', 3: 'bottom', middle: 'middle', top: 'top', bottom: 'bottom' };
  const alignment: Partial<ExcelJS.Alignment> = {};
  if (style.ht !== undefined && horizontalMap[String(style.ht)]) alignment.horizontal = horizontalMap[String(style.ht)];
  if (style.vt !== undefined && verticalMap[String(style.vt)]) alignment.vertical = verticalMap[String(style.vt)];
  // Univer IStyleData.tb: 1=overflow, 2=truncate, 3=wrap. tr is text rotation, not wrapping.
  if (style.tb === 3 || style.tb === 'wrap') alignment.wrapText = true;
  if (typeof style.tr === 'number' && Number.isFinite(style.tr)) alignment.textRotation = Math.max(0, Math.min(180, style.tr));
  if (style.indent && typeof style.indent === 'number') alignment.indent = Math.max(0, Math.min(15, style.indent));
  if (Object.keys(alignment).length) result.alignment = alignment;
  if (style.bd && typeof style.bd === 'object' && !Array.isArray(style.bd)) {
    const borders = style.bd as Record<string, unknown>;
    const excelBorder: Partial<ExcelJS.Borders> = {};
    for (const [sourceKey, targetKey] of [['t', 'top'], ['b', 'bottom'], ['l', 'left'], ['r', 'right']] as const) {
      const edge = borders[sourceKey];
      if (!edge || typeof edge !== 'object' || Array.isArray(edge)) continue;
      const edgeData = edge as Record<string, unknown>;
      const line = borderStyle(edgeData.s ?? edgeData.style);
      const color = colorArgb(edgeData.cl ?? edgeData.color);
      if (!line && !color) continue;
      excelBorder[targetKey] = { ...(line ? { style: line } : { style: 'thin' as const }), ...(color ? { color: { argb: color } } : {}) };
    }
    if (Object.keys(excelBorder).length) result.border = excelBorder as ExcelJS.Borders;
  }
  const numberFormat = style.n;
  const numberFormatPattern = typeof numberFormat === 'string' ? numberFormat : numberFormat && typeof numberFormat === 'object' && !Array.isArray(numberFormat) ? (numberFormat as Record<string, unknown>).pattern : undefined;
  if (typeof numberFormatPattern === 'string' && numberFormatPattern.length <= 80) result.numFmt = numberFormatPattern;
  return result;
}
function excelValue(value: unknown, format?: string): ExcelJS.CellValue {
  if (value === undefined || value === null) return null;
  if (format === 'DATE' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T12:00:00.000Z`);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  return String(value);
}

export async function buildReportStudioWorkbook(input: { definition: ReportStudioDefinition; dataset: ReportStudioDataset; templateName: string; templateVersion: number }): Promise<Buffer> {
  const rendered = renderReportStudio(input.definition, input.dataset);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = '墨衡工程经营管理系统';
  workbook.lastModifiedBy = '墨衡工程经营管理系统';
  workbook.created = new Date(input.dataset.generatedAt);
  workbook.modified = new Date(input.dataset.generatedAt);
  workbook.title = input.definition.title;
  workbook.subject = input.definition.domain === 'PROJECT' ? '项目级综合报表' : '公司级经营报表';
  workbook.company = '墨衡';
  workbook.properties.date1904 = false;
  for (const sheet of rendered.sheets) {
    const worksheet = workbook.addWorksheet(sheet.name.slice(0, 31) || '报表');
    worksheet.properties.defaultRowHeight = 20;
    worksheet.views = [{ state: 'frozen', ySplit: sheet.frozenRows, xSplit: sheet.frozenColumns }];
    worksheet.pageSetup = {
      paperSize: (input.definition.page.paper === 'A3' ? 8 : input.definition.page.paper === 'Letter' ? 1 : 9) as unknown as ExcelJS.PaperSize,
      orientation: input.definition.page.orientation,
      fitToPage: input.definition.page.fitToWidth,
      fitToWidth: input.definition.page.fitToWidth ? 1 : 0,
      fitToHeight: 0,
      margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 },
    };
    worksheet.pageSetup.horizontalCentered = false;
    worksheet.headerFooter.oddFooter = `${input.definition.page.footerText.replace(/&/g, '&&')}${input.definition.page.includeMetadata ? ` · ${input.definition.domain === 'PROJECT' ? '项目级' : '公司级'} · 模板 ${input.templateName} v${input.templateVersion}` : ''}　&P/&N`;
    for (const [columnKey, width] of Object.entries(sheet.columnWidths)) worksheet.getColumn(Number(columnKey) + 1).width = Math.min(80, Math.max(2, width / 7));
    for (let rowIndex = 0; rowIndex < sheet.rows.length; rowIndex += 1) {
      const rowData = sheet.rows[rowIndex]!;
      const row = worksheet.getRow(rowIndex + 1);
      const rowHeight = sheet.rowHeights[rowIndex];
      if (rowHeight) row.height = rowHeight;
      for (let columnIndex = 0; columnIndex < rowData.length; columnIndex += 1) {
        const renderedCell = rowData[columnIndex];
        if (!renderedCell) continue;
        const cell = row.getCell(columnIndex + 1);
        cell.value = excelValue(renderedCell.value, renderedCell.format);
        const style = styleToExcel(renderedCell.style);
        if (style) cell.style = style;
        // Explicit cell formatting from Univer takes precedence over the binding's default format.
        if (!style?.numFmt) {
          if (renderedCell.format === 'MONEY') cell.numFmt = '#,##0.00;[Red]-#,##0.00';
          else if (renderedCell.format === 'NUMBER') cell.numFmt = '#,##0.###';
          else if (renderedCell.format === 'DATE') cell.numFmt = 'yyyy-mm-dd';
          else if (renderedCell.format === 'TEXT') cell.numFmt = '@';
        }
      }
      row.commit();
    }
    for (const merge of sheet.merges) {
      if (merge.startRow <= sheet.rows.length && merge.endRow <= sheet.rows.length) {
        worksheet.mergeCells(merge.startRow + 1, merge.startColumn + 1, merge.endRow + 1, merge.endColumn + 1);
      }
    }
    if (sheet.rows.length && sheet.rows[0]!.length) worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rows.length, column: Math.max(1, ...sheet.rows.map((row) => row.length)) } };
  }
  if (input.definition.page.includeMetadata) {
    const metadata = workbook.addWorksheet('报表说明');
    metadata.columns = [{ width: 24 }, { width: 70 }];
    metadata.addRows([
      ['报表名称', input.definition.title], ['报表类型', input.definition.domain === 'PROJECT' ? '项目级综合报表' : '公司级经营报表'],
      ['模板名称', input.templateName], ['模板版本', input.templateVersion], ['生成时间', input.dataset.generatedAt],
      ['项目范围', input.dataset.projectId ?? `当前账号可访问的 ${input.dataset.accessibleProjectCount} 个项目`],
      ['注意事项', '本工作簿为只读快照，不会回写业务数据。公司级汇总仅包含当前用户有权访问的项目。超出 Excel 安全数值精度的金额将以文本保留完整十进制。'],
      ...(rendered.truncated ? [['截断提示', '部分集合明细或工作表行数达到上限，请调整报表范围后重新导出。']] : []),
      ...rendered.warnings.map((warning) => ['生成提示', warning]),
    ]);
    metadata.getRow(1).font = { bold: true, color: { argb: 'FF17324D' } };
    metadata.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
