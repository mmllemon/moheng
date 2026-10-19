import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStandardPreviewCell } from './report-preview-data.js';

test('standard report preview resolves reordered template columns by stable field key', () => {
  const fields = [
    { key: 'projectName', type: 'text' },
    { key: 'contractAmount', type: 'money' },
    { key: 'projectCode', type: 'text' },
  ];
  const row = ['示例项目', '123456.78', 'P-018'];
  const reorderedColumns = [
    { fieldKey: 'projectCode', staticValue: '' },
    { fieldKey: 'contractAmount', staticValue: '' },
    { fieldKey: 'projectName', staticValue: '' },
  ];

  const resolved = reorderedColumns.map((column) => resolveStandardPreviewCell(column, fields, row));
  assert.deepEqual(resolved.map((item) => item.value), ['P-018', '123456.78', '示例项目']);
  assert.deepEqual(resolved.map((item) => item.field?.key), ['projectCode', 'contractAmount', 'projectName']);
  assert.equal(resolved[1]!.field?.type, 'money');
});

test('static columns do not borrow a value from a same-position data field', () => {
  const result = resolveStandardPreviewCell(
    { fieldKey: null, staticValue: '人工核对' },
    [{ key: 'projectName', type: 'text' }],
    ['真实项目名称'],
  );
  assert.equal(result.value, '人工核对');
  assert.equal(result.field, undefined);
});

test('unknown binding keys fail closed to the configured static value', () => {
  const result = resolveStandardPreviewCell(
    { fieldKey: 'missingKey', staticValue: '需复核' },
    [{ key: 'projectName', type: 'text' }],
    ['真实项目名称'],
  );
  assert.equal(result.value, '需复核');
  assert.equal(result.field, undefined);
});
