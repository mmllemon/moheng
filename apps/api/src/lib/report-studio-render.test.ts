import test from 'node:test';
import ExcelJS from 'exceljs';
import { buildReportStudioWorkbook } from './report-studio-xlsx.js';
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
            '0': { '0': { v: '项目名称' }, '1': { v: '', s: { vt: 1, bl: 1, cl: '#123456', bg: '#AABBCC', bd: { b: { s: 1, cl: '#112233' } } } } },
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
    contracts: [{ id: 'contract-1', contractNo: 'HT-001', amount: 100 }, { id: 'contract-2', contractNo: 'HT-002', amount: 200 }],
    receipts: [{ id: 'receipt-1', receiptNo: 'SK-001', amount: 20 }, { id: 'receipt-2', receiptNo: 'SK-002', amount: 30 }, { id: 'receipt-3', receiptNo: 'SK-003', amount: 40 }],
  },
};

test('renders exact single-value cells and expands independent repeating regions', () => {
  const result = renderReportStudio(definition(), dataset);
  const rows = result.sheets[0]!.rows;
  assert.equal(rows[0]![1]!.value, '测试项目');
  // Both fields in each repeated row must come from the same source record, never by matching row index across sources.
  assert.equal(rows[2]![0]!.value, 'HT-001');
  assert.equal(rows[2]![1]!.value, 100);
  assert.equal(rows[3]![0]!.value, 'HT-002');
  assert.equal(rows[3]![1]!.value, 200);
  assert.equal(rows[4]![0]!.value, '固定结尾');
  assert.equal(rows[5]![0]!.value, '收款流水');
  assert.equal(rows[6]![0]!.value, 'SK-001');
  assert.equal(rows[6]![1]!.value, 20);
  assert.equal(rows[7]![0]!.value, 'SK-002');
  assert.equal(rows[7]![1]!.value, 30);
  assert.equal(rows[8]![0]!.value, 'SK-003');
  assert.equal(rows[8]![1]!.value, 40);
  assert.equal(rows[9]![0]!.value, '报告结束');
  assert.equal(result.sheets[0]!.frozenRows, 2);
});

test('renders a field binding when the workbook adapter omits its blank cell from cellData', () => {
  const report = definition();
  const sheets = (report.workbook as unknown as { sheets: Record<string, { cellData: Record<string, Record<string, unknown>> }> }).sheets;
  // Simulate spreadsheet adapters that serialize non-empty cells only. The binding must still be authoritative.
  sheets.main!.cellData['0'] = { '0': { v: '项目名称' } };
  const result = renderReportStudio(report, dataset);
  assert.equal(result.sheets[0]!.rows[0]![1]!.value, '测试项目');
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
  const result = renderReportStudio(definition(), { ...dataset, sources: { ...dataset.sources, contracts: [{ id: 'contract-large', contractNo: 'HT-LARGE', amount: '90071992547409.93' }] } });
  assert.equal(result.sheets[0]!.rows[2]![1]!.value, '90071992547409.93');
});


test("keeps amounts beyond Excel's 15-significant-digit limit as text", () => {
  const report = definition();
  report.bindings = [{ id: 'large-amount', sheetId: 'main', cell: 'B1', sourceId: 'project', fieldId: 'amount', format: 'MONEY' }];
  const input = { ...dataset, sources: { ...dataset.sources, project: { amount: '10000000000000.01' } } };
  const result = renderReportStudio(report, input);
  assert.equal(result.sheets[0]?.rows[0]?.[1]?.value, '10000000000000.01');
});


test('XLSX export starts with a styled overview sheet and preserves the report worksheets', async () => {
  const buffer = await buildReportStudioWorkbook({
    definition: definition(),
    dataset,
    templateName: '项目经营摘要模板',
    templateVersion: 3,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['报表预览', '测试表', '报表说明']);
  const overview = workbook.getWorksheet('报表预览')!;
  assert.equal(overview.getCell('A1').value, '区域渲染测试');
  assert.equal(overview.getCell('A4').value, '报表类型');
  assert.equal(overview.getCell('B4').value, '项目级综合报表');
  assert.equal(overview.getCell('B5').value, '项目经营摘要模板');
  assert.equal(overview.getCell('D5').value, 'v3');
  assert.equal(overview.getCell('B6').value, '测试项目');
  assert.equal(overview.getCell('B12').value, '测试表');
  assert.equal(overview.getCell('D12').value, '已生成');
  assert.equal(overview.getCell('A1').fill && (overview.getCell('A1').fill as { fgColor?: { argb?: string } }).fgColor?.argb, 'FF17324D');
  assert.equal(overview.pageSetup.fitToPage, true);

  // The export still contains the original user-designed sheet and values.
  const designedSheet = workbook.getWorksheet('测试表')!;
  assert.equal(designedSheet.getCell('B1').value, '测试项目');
  assert.equal(designedSheet.getCell('B1').alignment?.vertical, 'top');
  assert.equal(designedSheet.getCell('B1').font.color && (designedSheet.getCell('B1').font.color as { argb?: string }).argb, 'FF123456');
  assert.equal(designedSheet.getCell('B1').fill && (designedSheet.getCell('B1').fill as { fgColor?: { argb?: string } }).fgColor?.argb, 'FFAABBCC');
  assert.equal(designedSheet.getCell('B1').border.bottom?.style, 'thin');
  assert.equal(workbook.getWorksheet('报表说明')!.getCell('B1').value, '区域渲染测试');
});

test('XLSX overview prints truncation warnings when a repeating region reaches its configured cap', async () => {
  const report = definition();
  report.regions[0]!.maxRows = 1;
  const buffer = await buildReportStudioWorkbook({
    definition: report,
    dataset,
    templateName: '受限明细模板',
    templateVersion: 4,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  const overview = workbook.getWorksheet('报表预览')!;
  assert.equal(overview.getCell('B7').value, '存在截断，详见生成提示');
  assert.match(String(overview.pageSetup.printArea), /^A1:D\d+$/);
  const printEndRow = Number(String(overview.pageSetup.printArea).match(/D(\d+)$/)?.[1]);
  const overviewValues = overview.getColumn(1).values as unknown as unknown[];
  const truncationRow = overviewValues.findIndex((value) => String(value ?? '').includes('存在明细截断'));
  assert.ok(truncationRow > 0 && truncationRow <= printEndRow, 'truncation warning must be inside the overview print area');

  const metadata = workbook.getWorksheet('报表说明')!;
  assert.equal(metadata.getCell('A8').value, '截断提示');
  assert.match(String(metadata.getCell('B8').value), /达到上限/);
});

test('XLSX overview sheet remains available when the optional metadata sheet is disabled', async () => {
  const report = definition();
  report.page.includeMetadata = false;
  const buffer = await buildReportStudioWorkbook({
    definition: report,
    dataset,
    templateName: '最小元数据模板',
    templateVersion: 1,
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ['报表预览', '测试表']);
  assert.equal(workbook.getWorksheet('报表预览')!.getCell('B6').value, '测试项目');
});

test('renders downstream payment and refund collections into independent report regions', () => {
  const report = definition();
  const workbook = report.workbook as {
    sheets: Record<string, {
      rowCount: number;
      cellData: Record<string, Record<string, { v?: unknown; s?: unknown }>>;
    }>;
  };
  const main = workbook.sheets.main!;
  main.rowCount = 10;
  main.cellData['7'] = { '0': { v: '分供付款流水' } };
  main.cellData['8'] = { '0': { v: '分供合同编号' }, '1': { v: '支付/退款金额' } };
  main.cellData['9'] = { '0': { v: '' }, '1': { v: '' } };
  report.bindings.push(
    { id: 'payment-contract', sheetId: 'main', cell: 'A10', sourceId: 'downstreamPayments', fieldId: 'contractNo', format: 'TEXT' },
    { id: 'payment-amount', sheetId: 'main', cell: 'B10', sourceId: 'downstreamPayments', fieldId: 'amount', format: 'MONEY' },
  );
  report.regions.push({ id: 'payment-region', sheetId: 'main', sourceId: 'downstreamPayments', templateRow: 9, startColumn: 0, endColumn: 1, maxRows: 100 });
  const result = renderReportStudio(report, {
    ...dataset,
    sources: {
      ...dataset.sources,
      downstreamPayments: [
        { id: 'dp-1', contractNo: 'SC-001', amount: '10.50', type: 'PROGRESS' },
        { id: 'dp-2', contractNo: 'SC-002', amount: '3.25', type: 'REFUND' },
      ],
    },
  });
  const rows = result.sheets[0]!.rows;
  const section = rows.findIndex((row) => row[0]?.value === '分供付款流水');
  assert.ok(section >= 0);
  assert.equal(rows[section + 2]![0]!.value, 'SC-001');
  assert.equal(rows[section + 2]![1]!.value, 10.5);
  assert.equal(rows[section + 3]![0]!.value, 'SC-002');
  assert.equal(rows[section + 3]![1]!.value, 3.25);
});
