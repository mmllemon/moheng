import assert from 'node:assert/strict';
import test from 'node:test';
import type { CashflowBucket, CashflowPlan, CashflowTotals } from './cashflow.js';
import { aggregatePortfolioCashflows, type PortfolioProjectInput } from './portfolio-cashflow.js';

const asOf = new Date('2026-11-02T03:00:00.000Z');
const totals = (inflow: number, outflow: number): CashflowTotals => ({ inflow, outflow, net: inflow - outflow });
const bucket = (key: string, inflow: number, outflow: number): CashflowBucket => ({ key, label: `${Number(key.slice(5))}月`, ...totals(inflow, outflow) });

function plan(input: { buckets: CashflowBucket[]; window?: CashflowTotals; overdue?: CashflowTotals; unscheduled?: CashflowTotals; beyondWindow?: CashflowTotals }): CashflowPlan {
  return {
    asOf: asOf.toISOString(),
    months: input.buckets.length,
    buckets: input.buckets,
    window: input.window ?? totals(input.buckets.reduce((sum, item) => sum + item.inflow, 0), input.buckets.reduce((sum, item) => sum + item.outflow, 0)),
    overdue: input.overdue ?? totals(0, 0),
    unscheduled: input.unscheduled ?? totals(0, 0),
    beyondWindow: input.beyondWindow ?? totals(0, 0),
  };
}

function project(id: string, name: string, cashflow: CashflowPlan, extra: Partial<PortfolioProjectInput> = {}): PortfolioProjectInput {
  return {
    projectId: id,
    name,
    code: id.toUpperCase(),
    plan: cashflow,
    invoiceTax: extra.invoiceTax ?? { count: 0, amount: 0 },
    uncovered: extra.uncovered ?? { receivableWithoutDueDate: 0, payableWithoutDueDate: 0, unplannedContractCount: 0, unplannedContractAmount: 0 },
  };
}

test('两个项目的同月桶相加，净额按月合并', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 0, 1_000_000), bucket('2026-12', 3_000_000, 500_000)] })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 800_000, 0), bucket('2026-12', 0, 1_200_000)] })),
  ], asOf);
  assert.deepEqual(result.buckets.map((item) => [item.key, item.inflow, item.outflow, item.net]), [
    ['2026-11', 800_000, 1_000_000, -200_000],
    ['2026-12', 3_000_000, 1_700_000, 1_300_000],
  ]);
  assert.deepEqual(result.window, totals(3_800_000, 2_700_000));
});

test('月份键按时间升序，缺月份的键不会凭空补零桶', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2027-01', 100, 0)] })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-12', 0, 100)] })),
  ], asOf);
  assert.deepEqual(result.buckets.map((item) => item.key), ['2026-12', '2027-01']);
});

test('逾期与未设到期日单独汇总，不混进窗口', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 0, 100)], overdue: totals(700_000, 1_920_000), unscheduled: totals(50_000, 0) })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 0, 200)], overdue: totals(0, 300_000) })),
  ], asOf);
  assert.deepEqual(result.overdue, totals(700_000, 2_220_000));
  assert.deepEqual(result.unscheduled, totals(50_000, 0));
  assert.deepEqual(result.window, totals(0, 300));
  assert.equal(result.buckets.length, 1);
});

test('项目行按窗口净额升序，缺口最大的排最前', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 100, 50)] })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 0, 900)] })),
    project('c', '丙项目', plan({ buckets: [bucket('2026-11', 500, 100)] })),
  ], asOf);
  assert.deepEqual(result.projects.map((row) => row.name), ['乙项目', '甲项目', '丙项目']);
  assert.deepEqual(result.projects[0]!.window, totals(0, 900));
});

test('金额用分累加，避免浮点误差在汇总时放大', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 0.1, 0)] })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 0.2, 0)] })),
  ], asOf);
  assert.equal(result.buckets[0]!.inflow, 0.3);
  assert.equal(result.window.net, 0.3);
});

test('销项税与未纳入计划的合同额跨项目累加', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 0, 0)] }), { invoiceTax: { count: 1, amount: 247_706.42 }, uncovered: { receivableWithoutDueDate: 1, payableWithoutDueDate: 0, unplannedContractCount: 2, unplannedContractAmount: 1_500_000 } }),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 0, 0)] }), { invoiceTax: { count: 2, amount: 90_000 }, uncovered: { receivableWithoutDueDate: 0, payableWithoutDueDate: 1, unplannedContractCount: 1, unplannedContractAmount: 300_000 } }),
  ], asOf);
  assert.deepEqual(result.invoiceTax, { count: 3, amount: 337_706.42 });
  assert.deepEqual(result.uncovered, { receivableWithoutDueDate: 1, payableWithoutDueDate: 1, unplannedContractCount: 3, unplannedContractAmount: 1_800_000 });
});

test('没有项目时给出全零结果，不抛错', () => {
  const result = aggregatePortfolioCashflows([], asOf);
  assert.deepEqual(result.window, totals(0, 0));
  assert.deepEqual(result.buckets, []);
  assert.deepEqual(result.projects, []);
  assert.equal(result.months, 0);
});

test('月份数以最长项目窗口为准，便于前端按统一宽度画柱', () => {
  const result = aggregatePortfolioCashflows([
    project('a', '甲项目', plan({ buckets: [bucket('2026-11', 0, 0)] })),
    project('b', '乙项目', plan({ buckets: [bucket('2026-11', 0, 0), bucket('2026-12', 0, 0), bucket('2027-01', 0, 0)] })),
  ], asOf);
  assert.equal(result.months, 3);
});
