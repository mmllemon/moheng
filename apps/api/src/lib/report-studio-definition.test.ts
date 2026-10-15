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
