import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ASSISTANT_READ_ONLY_TOOL_IDS,
  AssistantReadOnlyToolError,
  validateAssistantReadOnlyToolInput,
} from './assistant-read-only-tools.js';

test('assistant tool validator exposes exactly the three approved read-only tools', () => {
  assert.deepEqual(ASSISTANT_READ_ONLY_TOOL_IDS, [
    'project_operating_overview',
    'cost_variance',
    'change_evidence_completeness',
  ]);
  assert.deepEqual(validateAssistantReadOnlyToolInput({ toolId: 'cost_variance', projectId: ' project-1 ' }), {
    toolId: 'cost_variance', projectId: 'project-1',
  });
});

test('assistant tool validator rejects unknown, extra, malformed and unbounded identifiers', () => {
  for (const input of [null, [], 'cost_variance', { toolId: 'write_payment', projectId: 'project-1' }, { toolId: 'cost_variance', projectId: 'project-1', sql: 'DROP TABLE Project' }, { toolId: 'cost_variance', projectId: '' }, { toolId: 'cost_variance', projectId: 'x'.repeat(101) }]) {
    assert.throws(() => validateAssistantReadOnlyToolInput(input), AssistantReadOnlyToolError);
  }
});
