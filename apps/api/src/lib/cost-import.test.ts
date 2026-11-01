import assert from 'node:assert/strict';
import test from 'node:test';
import { COST_IMPORT_COLUMNS, mapCostImportHeaders, parseCostImportRows } from './cost-import.js';

const headers = COST_IMPORT_COLUMNS.map((column) => column.header);

/**
 * 按字段名造一行，而不是手写位置数组：模板加列时改这里一处，
 * 不会出现「数组少一格、断言静默错位」这种假绿。
 */
type Field =
  | 'date' | 'type' | 'description' | 'amount' | 'taxRate' | 'taxAmount' | 'budgetItemCode' | 'contractNo'
  | 'partyName' | 'quantity' | 'unit' | 'unitPrice' | 'invoiceNo' | 'teamName' | 'notes';
const FIELD_ORDER: Field[] = ['date', 'type', 'description', 'amount', 'taxRate', 'taxAmount', 'budgetItemCode', 'contractNo', 'partyName', 'quantity', 'unit', 'unitPrice', 'invoiceNo', 'teamName', 'notes'];
const makeRow = (fields: Partial<Record<Field, string>>): string[] => {
  const merged: Record<Field, string> = Object.fromEntries(FIELD_ORDER.map((key) => [key, ''])) as Record<Field, string>;
  Object.assign(merged, fields);
  return FIELD_ORDER.map((key) => merged[key]);
};

test('模板列顺序与解析器一致，能一次性对上所有字段', () => {
  const { index, missing, unknown } = mapCostImportHeaders(headers);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, []);
  assert.equal(index.date, 0);
  assert.equal(index.type, 1);
  assert.equal(index.description, 2);
  assert.equal(index.amount, 3);
  assert.equal(index.taxRate, 4);
  assert.equal(index.taxAmount, 5);
  assert.equal(index.budgetItemCode, 6);
  assert.equal(index.contractNo, 7);
  assert.equal(index.partyName, 8);
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
  const { rows } = parseCostImportRows(headers, [makeRow({ date: '2026/10/9', type: '材料', description: '三级钢 HRB400', amount: '1,234.567' })]);
  assert.equal(rows[0]!.valid, true, JSON.stringify(rows[0]!.errors));
  assert.equal(rows[0]!.data?.date, '2026-10-09');
  assert.equal(rows[0]!.data?.type, 'MATERIAL');
  assert.equal(rows[0]!.data?.amount, 1234.57);
  assert.equal(rows[0]!.data?.taxRate, null);
  assert.equal(rows[0]!.data?.taxAmount, null);
});

test('枚举名直接写在类型列也接受', () => {
  const { rows } = parseCostImportRows(headers, [makeRow({ date: '2026-10-09', type: 'SUBCONTRACT', description: '劳务分包', amount: '100' })]);
  assert.equal(rows[0]!.valid, true);
  assert.equal(rows[0]!.data?.type, 'SUBCONTRACT');
});

test('金额必须大于 0，负数与零都拒绝', () => {
  const { rows } = parseCostImportRows(headers, [
    makeRow({ date: '2026-10-09', type: '人工', description: '零金额', amount: '0' }),
    makeRow({ date: '2026-10-09', type: '人工', description: '负金额', amount: '-5' }),
  ]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /金额必须大于 0/);
  assert.equal(rows[1]!.valid, false);
});

test('日期格式错误与不存在的日期都拒绝', () => {
  const { rows } = parseCostImportRows(headers, [
    makeRow({ date: '2026/13/01', type: '人工', description: '月份越界', amount: '10' }),
    makeRow({ date: '10月9日', type: '人工', description: '中文日期', amount: '10' }),
  ]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /无法识别/);
  assert.equal(rows[1]!.valid, false);
});

test('类型不在允许范围时提示可选值', () => {
  const { rows } = parseCostImportRows(headers, [makeRow({ date: '2026-10-09', type: '差旅', description: '交通费', amount: '100' })]);
  assert.equal(rows[0]!.valid, false);
  assert.match(rows[0]!.errors.join('；'), /不在允许范围/);
});

test('可选数值列非负，非法文本被指出', () => {
  const { rows } = parseCostImportRows(headers, [
    makeRow({ date: '2026-10-09', type: '机械', description: '台班', amount: '500', taxAmount: '30', budgetItemCode: 'QD-001', partyName: '某租赁公司', quantity: '10', unit: '台班', unitPrice: '50', invoiceNo: 'FP-1', teamName: '张班组', notes: '备注' }),
    makeRow({ date: '2026-10-09', type: '机械', description: '台班', amount: '500', taxAmount: 'abc' }),
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

test('税率列：合法百分数被读成数值，越界与非法文本被拒', () => {
  const { rows } = parseCostImportRows(headers, [
    makeRow({ date: '2026-10-09', type: '材料', description: '钢材', amount: '1130', taxRate: '13' }),
    makeRow({ date: '2026-10-09', type: '材料', description: '钢材', amount: '1130', taxRate: '130' }),
    makeRow({ date: '2026-10-09', type: '材料', description: '钢材', amount: '1130', taxRate: '不含税' }),
  ]);
  assert.equal(rows[0]!.valid, true, JSON.stringify(rows[0]!.errors));
  assert.equal(rows[0]!.data?.taxRate, 13);
  assert.match(rows[1]!.errors.join('；'), /税率需在 0 到 100 之间/);
  assert.match(rows[2]!.errors.join('；'), /税率/);
});

test('行号按 Excel 习惯从第 2 行起，便于用户对照', () => {
  const { rows } = parseCostImportRows(headers, [
    makeRow({ date: '2026-10-09', type: '人工', description: 'a', amount: '1' }),
    makeRow({ date: '2026-10-09', type: '人工', description: 'b', amount: '1' }),
  ]);
  assert.equal(rows[0]!.rowNumber, 2);
  assert.equal(rows[1]!.rowNumber, 3);
});
