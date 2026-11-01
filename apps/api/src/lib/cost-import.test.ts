import assert from 'node:assert/strict';
import test from 'node:test';
import { COST_IMPORT_COLUMNS, mapCostImportHeaders, parseCostImportRows } from './cost-import.js';

const headers = COST_IMPORT_COLUMNS.map((column) => column.header);

test('模板列顺序与解析器一致，能一次性对上所有字段', () => {
  const { index, missing, unknown } = mapCostImportHeaders(headers);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
  assert.equal(index.date, 0);
  assert.equal(index.type, 1);
  assert.equal(index.description, 2);
  assert.equal(index.amount, 3);
  assert.equal(index.budgetItemCode, 5);
  assert.equal(index.contractNo, 6);
  assert.equal(index.partyName, 7);
});

test('缺必填列时整表拒绝，并指出缺哪几列', () => {
  const { missing } = mapCostImportHeaders(['日期', '类型', '费用说明']);
  assert.deepEqual(missing, ['金额(元)']);
});

test('未知表头被忽略，不影响必填列定位', () => {
  const { index, unknown } = mapCostImportHeaders(['日期', '类型', '费用说明', '金额(元)', '随便一列']);
  assert.deepEqual(unknown, ['随便一列']);
  assert.equal(index.amount, 3);
});

test('合法行：日期归一、中文类型映射成枚举、金额带千分位也能解析', () => {
  const row = ['2026/10/9', '材料', '三级钢 HRB400', '1,234.567', '', '', '', '', '', '', '', '', '', ''];
  const { rows } = parseCostImportRows(headers, [row]);
  assert.equal(rows[0]!.valid, true, JSON.stringify(rows[0]!.errors));
  assert.equal(rows[0]!.data?.date, '2026-10-09');
  assert.equal(rows[0]!.data?.type, 'MATERIAL');
  assert.equal(rows[0]!.data?.amount, 1234.57);
  assert.equal(rows[0]!.data?.taxAmount, null);
});

test('枚举名直接写在类型列也接受', () => {
  const { rows } = parseCostImportRows(headers, [['2026-10-09', 'SUBCONTRACT', '劳务分包', '100', '', '', '', '', '', '', '', '', '', '']]);
  assert.equal(rows[0]!.valid, true);
  assert.equal(rows[0]!.data?.type, 'SUBCONTRACT');
});

test('金额必须大于 0，负数与零都拒绝', () => {
  const { rows } = parseCostImportRows(headers, [
    ['2026-10-09', '人工', '零金额', '0', '', '', '', '', '', '', '', '', '', ''],
    ['2026-10-09', '人工', '负金额', '-5', '', '', '', '', '', '', '', '', '', ''],
  ]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /金额必须大于 0/);
  assert.equal(rows[1]!.valid, false);
});

test('日期格式错误与不存在的日期都拒绝', () => {
  const { rows } = parseCostImportRows(headers, [
    ['2026/13/01', '人工', '月份越界', '10', '', '', '', '', '', '', '', '', '', ''],
    ['10月9日', '人工', '中文日期', '10', '', '', '', '', '', '', '', '', '', ''],
  ]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /无法识别/);
  assert.equal(rows[1]!.valid, false);
});

test('类型不在允许范围时提示可选值', () => {
  const { rows } = parseCostImportRows(headers, [['2026-10-09', '差旅', '交通费', '100', '', '', '', '', '', '', '', '', '', '']]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /不在允许范围/);
});

test('可选数值列非负，非法文本被指出', () => {
  const { rows } = parseCostImportRows(headers, [
    ['2026-10-09', '机械', '台班', '500', '30', 'QD-001', '', '某租赁公司', '10', '台班', '50', 'FP-1', '张班组', '备注'],
    ['2026-10-09', '机械', '台班', '500', 'abc', '', '', '', '', '', '', '', '', ''],
  ]);
  assert.equal(rows[0]!.valid, true, JSON.stringify(rows[0]!.errors));
  assert.equal(rows[0]!.data?.taxAmount, 30);
  assert.equal(rows[0]!.data?.quantity, 10);
  assert.equal(rows[0]!.data?.unitPrice, 50);
  assert.equal(rows[0]!.data?.budgetItemCode, 'QD-001');
  assert.equal(rows[0]!.data?.partyName, '某租赁公司');
  assert.equal(rows[1]!.valid, false);
  assert.match(rows[1]!.errors.join('；'), /税额/);
});

test('行号按 Excel 习惯从第 2 行起，便于用户对照', () => {
  const { rows } = parseCostImportRows(headers, [
    ['2026-10-09', '人工', 'a', '1', '', '', '', '', '', '', '', '', '', ''],
    ['2026-10-09', '人工', 'b', '1', '', '', '', '', '', '', '', '', '', ''],
  ]);
  assert.equal(rows[0]!.rowNumber, 2);
  assert.equal(rows[1]!.rowNumber, 3);
});
