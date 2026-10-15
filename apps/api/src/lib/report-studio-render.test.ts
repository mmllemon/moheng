import test from 'node:test';
import assert from 'node:assert/strict';
import { renderReportStudio, previewReportStudio } from './report-studio-render.js';
import type { ReportStudioDefinition } from './report-studio-definition.js';
import type { ReportStudioDataset } from './report-studio-data.js';

function definition(): ReportStudioDefinition {
  return {
    schemaVersion: 2,
    domain: 'PROJECT',
    title: '区域渲染测试',
    description: '',
    workbook: {
      id: 'test-workbook', name: '测试工作簿', sheetOrder: ['main'], styles: {},
      sheets: {
        main: {
          id: 'main', name: '测试表', rowCount: 8, columnCount: 4,
          cellData: {
            '0': { '0': { v: '项目名称' }, '1': { v: '' } },
            '1': { '0': { v: '合同编号' }, '1': { v: '合同额' } },
            '2': { '0': { v: '' }, '1': { v: '' } },
            '3': { '0': { v: '固定结尾' } },
            '4': { '0': { v: '收款流水' }, '1': { v: '金额' } },
            '5': { '0': { v: '' }, '1': { v: '' } },
            '6': { '0': { v: '报告结束' } },
          },
          rowData: { '0': { h: 30 }, '2': { h: 24 } },
          columnData: { '0': { w: 130 }, '1': { w: 120 } },
          mergeData: [], freeze: { ySplit: 2, xSplit: 0 },
        },
      },
    },
    bindings: [
      { id: 'project-name', sheetId: 'main', cell: 'B1', sourceId: 'project', fieldId: 'name', format: 'TEXT' },
      { id: 'contract-no', sheetId: 'main', cell: 'A3', sourceId: 'contracts', fieldId: 'contractNo', format: 'TEXT' },
      { id: 'contract-amount', sheetId: 'main', cell: 'B3', sourceId: 'contracts', fieldId: 'amount', format: 'MONEY' },
      { id: 'receipt-no', sheetId: 'main', cell: 'A6', sourceId: 'receipts', fieldId: 'receiptNo', format: 'TEXT' },
      { id: 'receipt-amount', sheetId: 'main', cell: 'B6', sourceId: 'receipts', fieldId: 'amount', format: 'MONEY' },
    ],
    regions: [
      { id: 'contract-region', sheetId: 'main', sourceId: 'contracts', templateRow: 2, startColumn: 0, endColumn: 1, maxRows: 100 },
      { id: 'receipt-region', sheetId: 'main', sourceId: 'receipts', templateRow: 5, startColumn: 0, endColumn: 1, maxRows: 100 },
    ],
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, includeMetadata: true, footerText: '测试' },
  };
}

const dataset: ReportStudioDataset = {
  domain: 'PROJECT', generatedAt: '2026-10-15T00:00:00.000Z', projectId: 'project-1', accessibleProjectCount: 1, warnings: [],
  sources: {
    project: { name: '测试项目' },
    contracts: [{ contractNo: 'HT-001', amount: 100 }, { contractNo: 'HT-002', amount: 200 }],
    receipts: [{ receiptNo: 'SK-001', amount: 20 }, { receiptNo: 'SK-002', amount: 30 }, { receiptNo: 'SK-003', amount: 40 }],
  },
};

test('renders exact single-value cells and expands independent repeating regions', () => {
  const result = renderReportStudio(definition(), dataset);
  const rows = result.sheets[0]!.rows;
  assert.equal(rows[0]![1]!.value, '测试项目');
  assert.equal(rows[2]![0]!.value, 'HT-001');
  assert.equal(rows[3]![0]!.value, 'HT-002');
  assert.equal(rows[4]![0]!.value, '固定结尾');
  assert.equal(rows[5]![0]!.value, '收款流水');
  assert.equal(rows[6]![0]!.value, 'SK-001');
  assert.equal(rows[7]![0]!.value, 'SK-002');
  assert.equal(rows[8]![0]!.value, 'SK-003');
  assert.equal(rows[9]![0]!.value, '报告结束');
  assert.equal(result.sheets[0]!.frozenRows, 2);
});

test('preview is bounded and marks truncation without changing the render source', () => {
  const result = renderReportStudio(definition(), dataset);
  const preview = previewReportStudio(result, 4);
  assert.equal(preview.sheets[0]!.previewRowCount, 4);
  assert.equal(preview.sheets[0]!.truncated, true);
  assert.equal(preview.sheets[0]!.rows.length, 4);
  assert.equal(result.sheets[0]!.rows.length, 10);
});

test('empty repeating regions render one blank template row rather than removing downstream layout', () => {
  const result = renderReportStudio(definition(), { ...dataset, sources: { ...dataset.sources, contracts: [], receipts: [] } });
  const rows = result.sheets[0]!.rows;
  assert.equal(rows[2]![0]!.value, null);
  assert.equal(rows[3]![0]!.value, '固定结尾');
  assert.equal(rows[5]![0]!.value, null);
  assert.equal(rows[6]![0]!.value, '报告结束');
});


test('preserves monetary values as exact decimal text when spreadsheet numeric precision would round cents', () => {
  const result = renderReportStudio(definition(), { ...dataset, sources: { ...dataset.sources, contracts: [{ contractNo: 'HT-LARGE', amount: '90071992547409.93' }] } });
  assert.equal(result.sheets[0]!.rows[2]![1]!.value, '90071992547409.93');
});


test("keeps amounts beyond Excel's 15-significant-digit limit as text", () => {
  const report = definition();
  report.bindings = [{ id: 'large-amount', sheetId: 'main', cell: 'B1', sourceId: 'project', fieldId: 'amount', format: 'MONEY' }];
  const input = { ...dataset, sources: { ...dataset.sources, project: { amount: '10000000000000.01' } } };
  const result = renderReportStudio(report, input);
  assert.equal(result.sheets[0]?.rows[0]?.[1]?.value, '10000000000000.01');
});
