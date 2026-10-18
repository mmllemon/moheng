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

test('the party template labels its internal database identifier honestly', () => {
  const definition = createDefaultStudioDefinition('PARTY');
  const workbook = definition.workbook as { sheets: Record<string, { cellData: Record<string, Record<string, { v?: unknown }>> }> };
  assert.equal(workbook.sheets.sheet1?.cellData['3']?.['6']?.v, '系统档案 ID');
});
