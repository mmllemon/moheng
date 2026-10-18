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
