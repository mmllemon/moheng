import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProjectPermissionPolicy } from './access-policy.js';
import { permitsCrossProjectRead } from './project-data-scope.js';

const base = { globalRole: 'USER', userRole: 'USER', isActive: true, dataScope: 'ALL_PROJECTS_READONLY' };

test('cross-project data scope is read-only and never grants business writes or administration', () => {
  const policy = defaultProjectPermissionPolicy();
  assert.equal(permitsCrossProjectRead({ ...base, permissionKey: 'PROJECT_READ', policy }), true);
  assert.equal(permitsCrossProjectRead({ ...base, permissionKey: 'REPORT_EXPORT', policy }), true);
  for (const permissionKey of ['PROJECT_MANAGE', 'TARGET_COST_WRITE', 'ACTUAL_COST_WRITE', 'CHANGE_APPROVE', 'OWNER_FINANCE_WRITE', 'DOWNSTREAM_FINANCE_WRITE'] as const) {
    assert.equal(permitsCrossProjectRead({ ...base, permissionKey, policy }), false, `${permissionKey} must not be granted`);
  }
});

test('cross-project scope fails closed for inactive accounts, normal scope, or a restricted viewer policy', () => {
  const policy = defaultProjectPermissionPolicy();
  assert.equal(permitsCrossProjectRead({ ...base, isActive: false, permissionKey: 'PROJECT_READ', policy }), false);
  assert.equal(permitsCrossProjectRead({ ...base, dataScope: 'ASSIGNED_PROJECTS', permissionKey: 'PROJECT_READ', policy }), false);
  policy.PROJECT_READ = ['OWNER', 'MANAGER'];
  assert.equal(permitsCrossProjectRead({ ...base, permissionKey: 'PROJECT_READ', policy }), false);
});
