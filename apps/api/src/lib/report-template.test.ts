import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultDefinition, validateReportTemplateDefinition } from './report-template.js';

const key = 'target-cost' as const;

test('default definition is valid and binds only current report fields', () => {
  const definition = createDefaultDefinition(key);
  const result = validateReportTemplateDefinition(definition, key);
  assert.equal(result.success, true);
  if (!result.success) return;
  assert.equal(result.data.columns.length, 13);
  assert.equal(result.data.columns.every((column) => column.visible), true);
  assert.equal(result.data.page.includeDescription, true);
});

test('unknown field keys are rejected by the report field allowlist', () => {
  const definition = createDefaultDefinition(key);
  definition.columns[0]!.fieldKey = 'other-report:field:0';
  const result = validateReportTemplateDefinition(definition, key);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /不允许的字段/);
});

test('a report template cannot hide every column', () => {
  const definition = createDefaultDefinition(key);
  definition.columns.forEach((column) => { column.visible = false; });
  const result = validateReportTemplateDefinition(definition, key);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /可见字段/);
});

test('duplicate field bindings are rejected even if column ids differ', () => {
  const definition = createDefaultDefinition(key);
  definition.columns[1]!.fieldKey = definition.columns[0]!.fieldKey;
  const result = validateReportTemplateDefinition(definition, key);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /重复绑定/);
});

test('custom layout rows must match the column count', () => {
  const definition = createDefaultDefinition(key);
  definition.customRows.push({ id: 'intro', height: 24, cells: ['only one cell'] });
  const result = validateReportTemplateDefinition(definition, key);
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.message, /单元格数量/);
});

test('merge regions must be within bounds and cannot overlap', () => {
  const definition = createDefaultDefinition(key);
  definition.customRows = [
    { id: 'r1', height: 24, cells: definition.columns.map(() => '') },
    { id: 'r2', height: 24, cells: definition.columns.map(() => '') },
  ];
  definition.merges = [{ row: 0, col: 0, rowSpan: 2, colSpan: 2 }, { row: 1, col: 1, rowSpan: 1, colSpan: 2 }];
  const overlap = validateReportTemplateDefinition(definition, key);
  assert.equal(overlap.success, false);
  if (!overlap.success) assert.match(overlap.message, /重叠/);
  definition.merges = [{ row: 1, col: 12, rowSpan: 2, colSpan: 1 }];
  const bounds = validateReportTemplateDefinition(definition, key);
  assert.equal(bounds.success, false);
  if (!bounds.success) assert.match(bounds.message, /超出/);
});
