import test from 'node:test';
import assert from 'node:assert/strict';
import { validateReportStudioDefinition } from './report-studio-definition.js';
import type { ReportStudioDefinition } from './report-studio-definition.js';

function definition(receiptBinding = false): ReportStudioDefinition {
  return {
    schemaVersion: 2,
    domain: 'PROJECT',
    title: '重复区域字段映射测试',
    description: '',
    workbook: {
      id: 'binding-test', name: '绑定测试', sheetOrder: ['sheet1'], styles: {},
      sheets: {
        sheet1: {
          id: 'sheet1', name: '明细', rowCount: 4, columnCount: 2,
          cellData: { '0': { '0': { v: '合同编号' }, '1': { v: '当前金额' } }, '1': { '0': { v: '' }, '1': { v: '' } } },
          rowData: {}, columnData: { '0': { w: 140 }, '1': { w: 120 } }, mergeData: [], freeze: { ySplit: 1, xSplit: 0 },
        },
      },
    },
    bindings: [
      { id: 'binding-contract-no', sheetId: 'sheet1', cell: 'A2', sourceId: 'downstreamContracts', fieldId: 'contractNo', format: 'TEXT' },
      { id: 'binding-amount', sheetId: 'sheet1', cell: 'B2', sourceId: receiptBinding ? 'ownerReceipts' : 'downstreamContracts', fieldId: receiptBinding ? 'receiptNo' : 'effectiveAmount', format: receiptBinding ? 'TEXT' : 'MONEY' },
    ],
    regions: [{ id: 'contract-rows', sheetId: 'sheet1', sourceId: 'downstreamContracts', templateRow: 1, startColumn: 0, endColumn: 1, maxRows: 20 }],
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, includeMetadata: true, footerText: '测试' },
  };
}

test('repeating row accepts multiple fields from its one bound collection', () => {
  const result = validateReportStudioDefinition(definition());
  assert.equal(result.success, true);
});

test('repeating row rejects a cell bound to another collection so row data cannot be cross-matched by position', () => {
  const result = validateReportStudioDefinition(definition(true));
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /对应的重复区域样板行/);
});
test('rejects unlisted workbook sheets so hidden workbook entries cannot bypass validation', () => {
  const report = definition();
  const workbook = report.workbook as unknown as { sheets: Record<string, unknown> };
  workbook.sheets.hidden = {
    id: 'hidden',
    rowCount: 1,
    columnCount: 1,
    cellData: { '0': { '0': { v: '隐藏单元格', f: '=1+1' } } },
    mergeData: [],
  };
  const result = validateReportStudioDefinition(report);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /工作表目录与工作表定义不一致/);
});

test('rejects malformed merge entries as validation errors rather than throwing', () => {
  const report = definition();
  const workbook = report.workbook as unknown as { sheets: Record<string, { mergeData: unknown[] }> };
  workbook.sheets.sheet1!.mergeData = [null];
  const result = validateReportStudioDefinition(report);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /合并区域定义无效/);
});

test('rejects overlapping merge regions before rendering or XLSX export', () => {
  const report = definition();
  const workbook = report.workbook as unknown as {
    sheets: Record<string, { mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }> }>;
  };
  workbook.sheets.sheet1!.mergeData = [
    { startRow: 2, startColumn: 0, endRow: 3, endColumn: 0 },
    { startRow: 3, startColumn: 0, endRow: 3, endColumn: 1 },
  ];
  const result = validateReportStudioDefinition(report);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /合并区域不能重叠/);
});

test('allows adjacent merge regions with no shared cells', () => {
  const report = definition();
  const workbook = report.workbook as unknown as {
    sheets: Record<string, { mergeData: Array<{ startRow: number; startColumn: number; endRow: number; endColumn: number }> }>;
  };
  workbook.sheets.sheet1!.mergeData = [
    { startRow: 2, startColumn: 0, endRow: 2, endColumn: 0 },
    { startRow: 2, startColumn: 1, endRow: 2, endColumn: 1 },
  ];
  const result = validateReportStudioDefinition(report);
  assert.equal(result.success, true);
});

