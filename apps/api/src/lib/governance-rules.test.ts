import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHANGE_APPROVER_ROLES, parseChangeApprovalDefinition } from './governance-rules.js';

test('change approval rule accepts only project owner/manager roles', () => {
  assert.deepEqual(parseChangeApprovalDefinition({ allowedProjectRoles: ['OWNER'] }), { allowedProjectRoles: ['OWNER'] });
  assert.deepEqual(DEFAULT_CHANGE_APPROVER_ROLES, ['OWNER', 'MANAGER']);
  assert.equal(parseChangeApprovalDefinition({ allowedProjectRoles: ['VIEWER'] }), null);
  assert.equal(parseChangeApprovalDefinition({ allowedProjectRoles: ['OWNER', 'OWNER'] }), null);
  assert.equal(parseChangeApprovalDefinition({ allowedProjectRoles: [] }), null);
});
