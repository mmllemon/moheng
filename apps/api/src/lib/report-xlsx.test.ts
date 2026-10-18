import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildReportWorkbook } from './report-xlsx.js';
import { createDefaultDefinition } from './report-template.js';
import { makeReportFields, reportCatalog, type ReportSnapshot } from './report-data.js';

test('standard XLSX begins with a styled overview sheet and preserves typed data and description sheets', async () => {
  const generatedAt = new Date('2026-10-15T02:00:00.000Z');
  const snapshot: ReportSnapshot = {
    report: reportCatalog.find((item) => item.key === 'target-cost')!,
    fields: makeReportFields('target-cost'),
    rows: [["=1+1", 'P-001', '000123', '土方开挖', null, null, 'm³', 12.5, 18.75, 234.375, 1, 1, generatedAt]],
    rowCount: 1, truncated: false, generatedAt, projectScope: '测试项目', filters: {},
  };
  const definition = createDefaultDefinition('target-cost');
  definition.columns = definition.columns.slice(0, 4);
  definition.customRows = [{ id: 'signoff', height: 26, cells: ['编制人：', '', '复核人：', ''] }];
  definition.merges = [{ row: 0, col: 0, rowSpan: 1, colSpan: 2 }];
  const buffer = await buildReportWorkbook({ snapshot, definition, templateName: '测试模板', templateVersion: 3 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['报表预览', '数据', '导出说明']);
  const overview = workbook.getWorksheet('报表预览')!;
  assert.equal(overview.getCell('A1').value, definition.title);
  assert.equal(overview.getCell('A4').value, '报表类型');
  assert.equal(overview.getCell('B4').value, '目标成本清单');
  assert.equal(overview.getCell('B5').value, '测试模板');
  assert.equal(overview.getCell('D5').value, 'v3');
  assert.equal(overview.getCell('B8').value, 1);
  assert.equal(overview.getCell('D8').value, 10000);
  assert.equal(overview.getCell('B14').value, '数据');
  assert.equal(overview.getCell('A1').fill && (overview.getCell('A1').fill as { fgColor?: { argb?: string } }).fgColor?.argb, 'FF17324D');
  const sheet = workbook.getWorksheet('数据')!;
  assert.equal(sheet.getCell('A1').value, definition.title);
  assert.equal(sheet.getCell('A3').value, '编制人：');
  assert.equal(sheet.getCell('A3').isMerged, true);
  assert.equal(sheet.getCell('A4').value, '项目名称');
  assert.equal(sheet.getCell('A5').value, '=1+1');
  assert.equal(sheet.getCell('A5').type, ExcelJS.ValueType.String);
  assert.equal(sheet.getCell('C5').value, '000123');
  assert.equal(sheet.views[0]?.state, 'frozen');
  assert.equal(workbook.getWorksheet('导出说明')!.getCell('B10').value, '1');
});

test('standard XLSX overview explicitly warns when the standard report row limit truncates results', async () => {
  const generatedAt = new Date('2026-10-15T02:00:00.000Z');
  const snapshot: ReportSnapshot = {
    report: reportCatalog.find((item) => item.key === 'target-cost')!,
    fields: makeReportFields('target-cost'),
    rows: [['P-001']],
    rowCount: 1,
    truncated: true,
    generatedAt,
    projectScope: '测试项目',
    filters: { from: '2026-01-01', to: '2026-10-15' },
  };
  const definition = createDefaultDefinition('target-cost');
  const buffer = await buildReportWorkbook({ snapshot, definition, templateName: '限额测试', templateVersion: 1 });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const overview = workbook.getWorksheet('报表预览')!;
  assert.equal(overview.getCell('B9').value, '达到导出上限，详见提示');
  assert.equal(overview.getCell('D7').value, '2026-10-15');
  assert.match(String(overview.getCell('A21').value), /达到导出上限|分批导出/);
  assert.equal(overview.pageSetup.fitToHeight, 0, 'row-limit warnings must not be compressed onto a single printed page');
  const overviewPrintEndRow = Number(String(overview.pageSetup.printArea).match(/D(\\d+)$/)?.[1]);
  assert.ok(overviewPrintEndRow >= 21, 'the overview print area must include its truncation warning');
  const dataSheet = workbook.getWorksheet('数据')!;
  assert.match(String(dataSheet.getCell(dataSheet.rowCount, 1).value), /达到导出上限/);
  assert.match(String(dataSheet.pageSetup.printArea), /A1:M6$/);
});

test('native XLSX can omit description sheet and rejects no-visible-column definitions', async () => {
  const generatedAt = new Date('2026-10-15T02:00:00.000Z');
  const snapshot: ReportSnapshot = {
    report: reportCatalog.find((item) => item.key === 'target-cost')!, fields: makeReportFields('target-cost'), rows: [], rowCount: 0,
    truncated: false, generatedAt, projectScope: '测试项目', filters: {},
  };
  const definition = createDefaultDefinition('target-cost');
  definition.page.includeDescription = false;
  const buffer = await buildReportWorkbook({ snapshot, definition, templateName: 'T', templateVersion: 1 });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['报表预览', '数据']);
  assert.equal(workbook.getWorksheet('报表预览')!.getCell('D8').value, 10000);
  definition.columns.forEach((column) => { column.visible = false; });
  await assert.rejects(() => buildReportWorkbook({ snapshot, definition, templateName: 'T', templateVersion: 1 }), /REPORT_TEMPLATE_NO_VISIBLE_COLUMNS/);
});
