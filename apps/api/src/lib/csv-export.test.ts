import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCsv, csvCell } from './csv-export.js';

test('CSV exports use UTF-8 BOM and quote commas, double quotes and line breaks', () => {
  const csv = buildCsv(['名称', '备注'], [['一号项目,二期', '他说"通过"\n继续'], ['正常', null]]);
  assert.ok(csv.startsWith('\uFEFF"名称","备注"'));
  assert.ok(csv.includes('"一号项目,二期"'));
  assert.ok(csv.includes('"他说""通过""\n继续"'));
  assert.ok(csv.endsWith('\r\n'));
});

test('CSV neutralizes spreadsheet formula cells while preserving ordinary negative numeric amounts', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+SUM(A1:A2)'), '"\'+SUM(A1:A2)"');
  assert.equal(csvCell('@command'), '"\'@command"');
  // Typed negative values, including Prisma Decimal objects, remain numeric.
  assert.equal(csvCell(-12.3), '"-12.3"');
  class Decimal { constructor(private readonly amount: string) {} toString() { return this.amount; } }
  assert.equal(csvCell(new Decimal('-12.30')), '"-12.30"');
  // A text field that merely looks like a negative number stays text-safe.
  assert.equal(csvCell('-12.30'), '"\'-12.30"');
  assert.equal(csvCell('常规字段'), '"常规字段"');
});
