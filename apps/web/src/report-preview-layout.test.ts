import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomRowMergeLayout } from './report-preview-layout.js';

test('custom-row merge coordinates are mapped to visible preview columns like XLSX export', () => {
  const layout = buildCustomRowMergeLayout([
    { row: 0, col: 0, rowSpan: 1, colSpan: 3 },
    { row: 0, col: 3, rowSpan: 2, colSpan: 2 },
  ], [0, 2, 3, 4], 2);

  assert.deepEqual(layout.mergeByStart.get('0:0'), { rowSpan: 1, colSpan: 2 });
  assert.deepEqual(layout.mergeByStart.get('0:2'), { rowSpan: 2, colSpan: 2 });
  assert.equal(layout.covered.has('0:1'), true);
  assert.equal(layout.covered.has('0:3'), true);
  assert.equal(layout.covered.has('1:2'), true);
  assert.equal(layout.covered.has('1:3'), true);
  assert.equal(layout.covered.has('1:0'), false);
});

test('invalid and fully hidden merges are ignored without hiding visible cells', () => {
  const layout = buildCustomRowMergeLayout([
    { row: 0, col: 10, rowSpan: 1, colSpan: 2 },
    { row: -1, col: 0, rowSpan: 1, colSpan: 2 },
    { row: 1, col: 0, rowSpan: 2, colSpan: 1 },
    { row: 0, col: 0, rowSpan: 1, colSpan: 1 },
  ], [0, 2], 2);

  assert.equal(layout.mergeByStart.size, 0);
  assert.equal(layout.covered.size, 0);
});
