import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProjectPermissionPolicy, parseProjectPermissionPolicy, PROJECT_PERMISSION_BASELINES } from './access-policy.js';

test('default project policy mirrors fixed code-defined capability ceilings', () => {
  assert.deepEqual(defaultProjectPermissionPolicy().PROJECT_READ, ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']);
  for (const [key, roles] of Object.entries(defaultProjectPermissionPolicy())) {
    assert.ok(roles.length > 0);
    assert.ok(roles.every((role) => (PROJECT_PERMISSION_BASELINES[key as keyof typeof PROJECT_PERMISSION_BASELINES] as readonly string[]).includes(role)));
  }
});

test('published policy can only narrow baseline roles, including denying a capability to all project roles', () => {
  const base = defaultProjectPermissionPolicy();
  base.CHANGE_APPROVE = ['OWNER'];
  base.REPORT_EXPORT = [];
  const parsed = parseProjectPermissionPolicy(base);
  assert.ok(parsed);
  assert.deepEqual(parsed.CHANGE_APPROVE, ['OWNER']);
  assert.deepEqual(parsed.REPORT_EXPORT, []);
});

test('policy rejects unknown keys, invalid roles, duplicates and permissions wider than the baseline', () => {
  const baseline = defaultProjectPermissionPolicy() as unknown as Record<string, unknown>;
  assert.equal(parseProjectPermissionPolicy({ ...baseline, ROOT_ACCESS: ['OWNER'] }), null);
  assert.equal(parseProjectPermissionPolicy({ ...baseline, CHANGE_APPROVE: ['VIEWER'] }), null);
  assert.equal(parseProjectPermissionPolicy({ ...baseline, CHANGE_APPROVE: ['OWNER', 'OWNER'] }), null);
  assert.equal(parseProjectPermissionPolicy({ ...baseline, CHANGE_APPROVE: ['ADMIN'] }), null);
});
