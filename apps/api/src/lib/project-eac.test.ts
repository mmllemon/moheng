import assert from 'node:assert/strict';
import test from 'node:test';
import { EAC_MIN_COMPLETION_RATIO, computeProjectEac } from './project-eac.js';

const base = { contractAmount: 10_000_000, budgetAtCompletion: 8_000_000, actualCost: 4_000_000, certifiedRevenue: 5_000_000 };

test('没有目标成本：不预测，也不把已发生成本冒充完工成本', () => {
  const result = computeProjectEac({ ...base, budgetAtCompletion: 0 });
  assert.equal(result.status, 'NO_BASELINE');
  assert.equal(result.valuation, null);
  assert.equal(result.margin, null);
  assert.equal(result.budgetAtCompletion, null);
});

test('没有合同额：算不出产值完成比，同属缺少基准', () => {
  const result = computeProjectEac({ ...base, contractAmount: 0 });
  assert.equal(result.status, 'NO_BASELINE');
  assert.equal(result.completionRatio, null);
});

test('产值完成比低于门槛：只报数据不足，不给单点', () => {
  const result = computeProjectEac({ ...base, certifiedRevenue: 1_000_000 });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.completionRatio, 0.1);
  assert.equal(result.minCompletionRatio, EAC_MIN_COMPLETION_RATIO);
  assert.equal(result.valuation, null);
  assert.equal(result.margin, null);
});

test('有产值但没有成本：成本未录入，拒绝给出 100% 利润', () => {
  const result = computeProjectEac({ ...base, actualCost: 0 });
  assert.equal(result.status, 'INSUFFICIENT_DATA');
  assert.equal(result.valuation, null);
});

test('达到门槛：按成本效率外推，中性值 = 已发生成本 ÷ 完成比', () => {
  const result = computeProjectEac(base);
  assert.equal(result.status, 'READY');
  assert.equal(result.method, 'CERTIFIED_REVENUE_RATIO');
  assert.equal(result.completionRatio, 0.5);
  assert.deepEqual(result.valuation, { low: 8_000_000, likely: 8_000_000, high: 8_000_000 });
  assert.equal(result.caution, false);
});

test('成本效率低于预算：当前效率外推高于目标成本，预算效率对照值居中', () => {
  const result = computeProjectEac({ ...base, actualCost: 5_000_000, certifiedRevenue: 4_000_000 });
  assert.equal(result.status, 'READY');
  assert.equal(result.completionRatio, 0.4);
  assert.equal(result.valuation?.low, 9_800_000);
  assert.equal(result.valuation?.likely, 12_500_000);
  assert.equal(result.valuation?.high, 12_500_000);
  assert.equal(result.budgetEfficiencyCost, 9_800_000);
  assert.ok((result.margin?.likely ?? 1) < 0);
});

test('成本效率高于预算：效率外推低于目标成本，区间上限由预算效率假设给出', () => {
  const result = computeProjectEac({ ...base, actualCost: 3_000_000, certifiedRevenue: 5_000_000 });
  assert.equal(result.valuation?.likely, 6_000_000);
  assert.equal(result.valuation?.low, 6_000_000);
  assert.equal(result.valuation?.high, 7_000_000);
  assert.equal(result.budgetEfficiencyCost, 7_000_000);
});

test('已提交未确认变更：只抬高区间上限', () => {
  const result = computeProjectEac({ ...base, actualCost: 5_000_000, certifiedRevenue: 4_000_000, pendingChangeExposure: 400_000 });
  assert.equal(result.valuation?.likely, 12_500_000);
  assert.equal(result.valuation?.high, 12_900_000);
  assert.equal(result.valuation?.low, 9_800_000);
});

test('产值为负敞口不计入悲观档', () => {
  const result = computeProjectEac({ ...base, actualCost: 5_000_000, certifiedRevenue: 4_000_000, pendingChangeExposure: -900_000 });
  assert.equal(result.valuation?.high, result.valuation?.likely);
});

test('产值完成比超过 100%：视为已完工，预计成本不低于已发生成本', () => {
  const result = computeProjectEac({ ...base, actualCost: 7_500_000, certifiedRevenue: 11_000_000 });
  assert.equal(result.completionRatio, 1.1);
  assert.equal(result.valuation?.likely, 7_500_000);
  assert.equal(result.valuation?.high, 7_500_000);
});

test('早期区间给出提示但仍然计算', () => {
  const result = computeProjectEac({ ...base, actualCost: 2_000_000, certifiedRevenue: 2_000_000 });
  assert.equal(result.status, 'READY');
  assert.equal(result.completionRatio, 0.2);
  assert.equal(result.caution, true);
});

test('利润率始终与完工成本同向：成本越高利润率越低', () => {
  const result = computeProjectEac({ ...base, actualCost: 5_000_000, certifiedRevenue: 4_000_000, pendingChangeExposure: 400_000 });
  assert.deepEqual(result.margin, { low: -0.29, likely: -0.25, high: 0.02 });
});

test('金额归一为两位小数，负数输入按 0 处理', () => {
  const result = computeProjectEac({ contractAmount: 10_000_000, budgetAtCompletion: 8_000_000, actualCost: 4_000_000.005, certifiedRevenue: 5_000_000, pendingChangeExposure: -1 });
  assert.equal(result.actualCost, 4_000_000.01);
  assert.equal(result.pendingChangeExposure, 0);
  assert.equal(result.valuation?.likely, 8_000_000.02);
});
