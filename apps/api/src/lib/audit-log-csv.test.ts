import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuditLogCsv, sanitizeAuditChanges } from './audit-log-csv.js';

test('audit CSV includes BOM, Chinese headers and escapes commas, quotes, and line breaks', () => {
  const csv = buildAuditLogCsv([{
    createdAt: new Date('2026-10-14T08:00:00.000Z'), actor: '李"明', projectName: '一号项目,二期',
    projectCode: 'XM-001', entity: 'CostEntry', entityId: 'c-1', action: 'UPDATE', changes: { note: '第一行\n第二行', amount: '120.00' },
  }]);
  assert.ok(csv.startsWith('\uFEFF"操作时间","操作人"'));
  assert.ok(csv.includes('"李""明"'));
  assert.ok(csv.includes('"一号项目,二期"'));
  assert.ok(csv.includes('"第一行\\n第二行"'));
});

test('audit CSV neutralizes spreadsheet formula injection in scalar cells', () => {
  const csv = buildAuditLogCsv([{
    createdAt: '=HYPERLINK("https://example.invalid")', actor: '+cmd', projectName: '正常项目', projectCode: '@SUM(1,1)',
    entity: 'Project', entityId: '-1+1', action: 'CREATE', changes: { value: '=1+1' },
  }]);
  assert.ok(csv.includes("'=HYPERLINK("));
  assert.ok(csv.includes("'+cmd"));
  assert.ok(csv.includes("'@SUM(1,1)"));
  assert.ok(csv.includes("'-1+1"));
  // JSON objects start with '{', so embedded text is exported as a quoted text cell.
  assert.ok(csv.includes('{""value"":""=1+1""}'));
});


test('audit snapshots redact credential-like keys recursively before display or export', () => {
  const result = sanitizeAuditChanges({
    name: '普通字段',
    passwordHash: 'never-export-this',
    accessToken: 'never-export-this-either',
    details: [{ refresh_token: 'secret', amount: '100.00' }],
  }) as Record<string, unknown>;
  assert.equal(result.name, '普通字段');
  assert.equal(result.passwordHash, '[已隐藏]');
  assert.equal(result.accessToken, '[已隐藏]');
  assert.deepEqual(result.details, [{ refresh_token: '[已隐藏]', amount: '100.00' }]);
});
