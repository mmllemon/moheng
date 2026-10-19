import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStandardReportPrintUrl, buildStudioReportPrintRequest } from './report-print.js';

test('standard report print URL requests all server-bounded rows and preserves the active filters', () => {
  assert.equal(
    buildStandardReportPrintUrl('target-cost', {
      projectId: 'project 1',
      from: '2026-01-01',
      to: '2026-09-30',
      templateId: 'template/with space',
    }),
    '/reports/target-cost/preview?projectId=project+1&from=2026-01-01&to=2026-09-30&templateId=template%2Fwith+space&printAll=true',
  );
});

test('company print request does not leak stale project or party context', () => {
  assert.deepEqual(
    buildStudioReportPrintRequest({
      templateId: 'company-template',
      domain: 'COMPANY',
      projectId: 'stale-project',
      businessPartyId: 'stale-party',
    }),
    { templateId: 'company-template', printAll: true },
  );
});

test('project print request retains only the selected project scope', () => {
  assert.deepEqual(
    buildStudioReportPrintRequest({
      templateId: 'project-template',
      domain: 'PROJECT',
      projectId: 'project-17',
      businessPartyId: 'stale-party',
    }),
    { templateId: 'project-template', projectId: 'project-17', printAll: true },
  );
});

test('party print request retains only the selected business party scope', () => {
  assert.deepEqual(
    buildStudioReportPrintRequest({
      templateId: 'party-template',
      domain: 'PARTY',
      projectId: 'stale-project',
      businessPartyId: 'party-9',
    }),
    { templateId: 'party-template', businessPartyId: 'party-9', printAll: true },
  );
});
