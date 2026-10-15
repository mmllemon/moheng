import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { buildReportWorkbook } from './report-xlsx.js';
import { createDefaultDefinition } from './report-template.js';
import { makeReportFields, reportCatalog, type ReportSnapshot } from './report-data.js';

test('native XLSX contains typed data sheet, template rows, frozen header, and description sheet', async () => {
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
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['数据', '导出说明']);
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
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['数据']);
  definition.columns.forEach((column) => { column.visible = false; });
  await assert.rejects(() => buildReportWorkbook({ snapshot, definition, templateName: 'T', templateVersion: 1 }), /REPORT_TEMPLATE_NO_VISIBLE_COLUMNS/);
});
