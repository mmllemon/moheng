import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReportStudioDefinition } from '../../apps/api/src/lib/report-studio-definition.js';
import { createDefaultStudioDefinition } from '../../apps/web/src/report-studio-default.ts';

for (const domain of ['PROJECT', 'COMPANY', 'PARTY'] as const) {
  test(`the built-in ${domain} Report Studio template satisfies the server validation contract`, () => {
    const result = validateReportStudioDefinition(createDefaultStudioDefinition(domain));
    assert.equal(result.success, true, result.success ? '' : result.message);
  });
}

test('built-in repeating-row date fields preserve Excel date formats', () => {
  const cases = [
    { domain: 'PROJECT', sourceId: 'downstreamContracts', fieldId: 'signedAt' },
    { domain: 'PROJECT', sourceId: 'ownerReceipts', fieldId: 'receivedAt' },
    { domain: 'PROJECT', sourceId: 'changes', fieldId: 'effectiveAt' },
    { domain: 'PROJECT', sourceId: 'downstreamPayments', fieldId: 'paidAt' },
    { domain: 'COMPANY', sourceId: 'companyDownstreamContracts', fieldId: 'signedAt' },
    { domain: 'COMPANY', sourceId: 'companyOwnerReceipts', fieldId: 'receivedAt' },
    { domain: 'COMPANY', sourceId: 'companyDownstreamPayments', fieldId: 'paidAt' },
    { domain: 'PARTY', sourceId: 'partyStandaloneCosts', fieldId: 'date' },
  ] as const;

  for (const item of cases) {
    const definition = createDefaultStudioDefinition(item.domain);
    const binding = definition.bindings.find((candidate) => candidate.sourceId === item.sourceId && candidate.fieldId === item.fieldId);
    assert.ok(binding, 'missing ' + item.domain + ' ' + item.sourceId + '.' + item.fieldId + ' binding');
    assert.equal(binding.format, 'DATE', item.domain + ' ' + item.sourceId + '.' + item.fieldId + ' must be an Excel date cell');
  }
});

test('the party template labels its internal database identifier honestly', () => {
  const definition = createDefaultStudioDefinition('PARTY');
  const workbook = definition.workbook as { sheets: Record<string, { cellData: Record<string, Record<string, { v?: unknown }>> }> };
  assert.equal(workbook.sheets.sheet1?.cellData['3']?.['6']?.v, '系统档案 ID');
});

test('default project main-contract amount binding uses the money format', () => {
  const report = createDefaultStudioDefinition('PROJECT');
  const binding = report.bindings.find((item) => item.sourceId === 'mainContract' && item.fieldId === 'amount');
  assert.ok(binding, 'the default project report should bind the main-contract amount');
  assert.equal(binding.format, 'MONEY');
});

test('project template keeps the downstream payment region aligned to its header and populated row', () => {
  const definition = createDefaultStudioDefinition('PROJECT');
  const region = definition.regions.find((candidate) => candidate.sourceId === 'downstreamPayments');
  assert.ok(region, 'the project template should include downstream payments');
  assert.equal(region.templateRow, 22, 'the repeated-row template is the zero-based 23rd spreadsheet row');

  const workbook = definition.workbook as {
    sheets: Record<string, { cellData: Record<string, Record<string, { v?: unknown }>> }>;
  };
  const cellData = workbook.sheets.sheet1?.cellData;
  assert.ok(cellData, 'the project template sheet should have cell data');
  assert.deepEqual(
    Array.from({ length: 6 }, (_, column) => cellData['21']?.[String(column)]?.v),
    ['合同编号', '类型', '支付/退款金额', '支付日期', '支付参考号', '原付款参考号'],
    'the row immediately above the region must contain all payment/refund column headers',
  );
  assert.deepEqual(
    Array.from({ length: 6 }, (_, column) => cellData['22']?.[String(column)]?.v),
    [
      '{{downstreamPayments.contractNo}}',
      '{{downstreamPayments.type}}',
      '{{downstreamPayments.amount}}',
      '{{downstreamPayments.paidAt}}',
      '{{downstreamPayments.referenceNo}}',
      '{{downstreamPayments.originalReferenceNo}}',
    ],
    'the repeated-row template must provide all six bound cells',
  );
});
