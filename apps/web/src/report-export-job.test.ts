import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyReportExportJob } from './report-export-job.js';

test('export jobs remain pending until a terminal state is reached', () => {
  for (const status of ['QUEUED', 'RUNNING', 'RETRY_WAIT']) {
    assert.equal(classifyReportExportJob({ status }), 'pending', status);
  }
});

test('failed and cancelled export jobs stop polling', () => {
  assert.equal(classifyReportExportJob({ status: 'FAILED' }), 'failed');
  assert.equal(classifyReportExportJob({ status: 'CANCELLED' }), 'failed');
});

test('a succeeded export is downloadable only when the artifact is available and has a URL', () => {
  assert.equal(classifyReportExportJob({ status: 'SUCCEEDED', resultAvailable: true, downloadUrl: '/api/reports/jobs/123/download' }), 'downloadable');
  assert.equal(classifyReportExportJob({ status: 'SUCCEEDED', resultAvailable: false, downloadUrl: '/api/reports/jobs/123/download' }), 'completed-unavailable');
  assert.equal(classifyReportExportJob({ status: 'SUCCEEDED', resultAvailable: true, downloadUrl: null }), 'completed-unavailable');
  assert.equal(classifyReportExportJob({ status: 'SUCCEEDED', resultAvailable: true }), 'completed-unavailable');
});
