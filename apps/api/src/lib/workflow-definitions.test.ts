import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CHANGE_WORKFLOW, parseWorkflowDefinition, workflowTransitionAllowed } from './workflow-definitions.js';

test('default internal change workflow is valid and forbids self-approval on confirmation', () => {
  assert.deepEqual(parseWorkflowDefinition(DEFAULT_CHANGE_WORKFLOW), DEFAULT_CHANGE_WORKFLOW);
  const result = workflowTransitionAllowed({ definition: DEFAULT_CHANGE_WORKFLOW, from: 'UNDER_REVIEW', to: 'CONFIRMED', role: 'MANAGER', submittedAmount: '100.00' });
  assert.deepEqual(result, { allowed: true, selfApprovalForbidden: true, reason: null });
});

test('workflow enforces project role and amount conditions using decimal cents', () => {
  const definition = parseWorkflowDefinition({ states: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED'], transitions: [
    { from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['OWNER', 'ESTIMATOR'], selfApprovalForbidden: false },
    { from: 'UNDER_REVIEW', to: 'CONFIRMED', allowedProjectRoles: ['OWNER'], selfApprovalForbidden: true, condition: { field: 'submittedAmount', op: 'LTE', value: '1000.00' } },
  ] });
  assert.ok(definition);
  assert.deepEqual(workflowTransitionAllowed({ definition, from: 'UNDER_REVIEW', to: 'CONFIRMED', role: 'VIEWER', submittedAmount: '10.00' }), { allowed: false, selfApprovalForbidden: true, reason: 'ROLE_NOT_ALLOWED' });
  assert.equal(workflowTransitionAllowed({ definition, from: 'UNDER_REVIEW', to: 'CONFIRMED', role: 'OWNER', submittedAmount: '1000.01' }).reason, 'CONDITION_NOT_MET');
  assert.equal(workflowTransitionAllowed({ definition, from: 'UNDER_REVIEW', to: 'CONFIRMED', role: 'OWNER', submittedAmount: '1000.00' }).allowed, true);
});

test('workflow rejects invalid status, duplicate transitions, arbitrary roles, and malformed thresholds', () => {
  const invalid = { states: ['DRAFT', 'SUBMITTED'], transitions: [{ from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['ADMIN'], selfApprovalForbidden: false }] };
  assert.equal(parseWorkflowDefinition(invalid), null);
  assert.equal(parseWorkflowDefinition({ states: ['DRAFT', 'SUBMITTED'], transitions: [
    { from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['OWNER'], selfApprovalForbidden: false },
    { from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['MANAGER'], selfApprovalForbidden: false },
  ] }), null);
});
