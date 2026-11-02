import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateScheduleOpen, buildCashflow, cashflowSlot, type CashflowEntry } from './cashflow.js';

const asOf = new Date('2026-11-02T10:00:00.000Z');
const entry = (direction: 'INFLOW' | 'OUTFLOW', date: string | null, amount: number, source: CashflowEntry['source'] = 'RECEIVABLE'): CashflowEntry => ({
  direction, dueAt: date ? new Date(`${date}T00:00:00.000Z`) : null, amount, source,
});

test('按月分桶：同月多笔合并，净额为收减付', () => {
  const plan = buildCashflow([
    entry('INFLOW', '2026-11-15', 1_000_000),
    entry('INFLOW', '2026-11-28', 500_000),
    entry('OUTFLOW', '2026-11-20', 800_000, 'PAYABLE'),
  ], { asOf });
  assert.equal(plan.buckets.length, 6);
  assert.equal(plan.buckets[0]!.key, '2026-11');
  assert.equal(plan.buckets[0]!.inflow, 1_500_000);
  assert.equal(plan.buckets[0]!.outflow, 800_000);
  assert.equal(plan.buckets[0]!.net, 700_000);
  assert.equal(plan.window.net, 700_000);
});

test('逾期金额单列，不混入当月', () => {
  const plan = buildCashflow([
    entry('OUTFLOW', '2025-10-20', 1_920_000, 'PAYABLE'),
    entry('INFLOW', '2026-11-05', 300_000),
  ], { asOf });
  assert.equal(plan.overdue.outflow, 1_920_000);
  assert.equal(plan.buckets[0]!.outflow, 0);
  assert.equal(plan.buckets[0]!.inflow, 300_000);
});

test('当天到期算当期，不算逾期', () => {
  const plan = buildCashflow([entry('INFLOW', '2026-11-02', 120_000)], { asOf });
  assert.equal(plan.overdue.inflow, 0);
  assert.equal(plan.buckets[0]!.inflow, 120_000);
});

test('没有到期日的金额单独统计，不进任何月份', () => {
  const plan = buildCashflow([entry('INFLOW', null, 6_000_000)], { asOf });
  assert.equal(plan.unscheduled.inflow, 6_000_000);
  assert.equal(plan.window.inflow, 0);
  assert.equal(plan.buckets.every((bucket) => bucket.inflow === 0), true);
});

test('超出窗口的到期日归入窗口之外', () => {
  const plan = buildCashflow([entry('INFLOW', '2027-09-30', 900_000)], { asOf });
  assert.equal(plan.beyondWindow.inflow, 900_000);
  assert.equal(plan.window.inflow, 0);
});

test('窗口边界：最后一桶的月末仍属于窗口', () => {
  const plan = buildCashflow([entry('OUTFLOW', '2027-04-30', 50_000, 'PAYABLE')], { asOf });
  assert.equal(plan.buckets[5]!.key, '2027-04');
  assert.equal(plan.buckets[5]!.outflow, 50_000);
  assert.equal(plan.beyondWindow.outflow, 0);
});

test('跨年时标签只保留月份，键保留年份', () => {
  const plan = buildCashflow([], { asOf });
  assert.deepEqual(plan.buckets.map((bucket) => bucket.label), ['11月', '12月', '1月', '2月', '3月', '4月']);
  assert.equal(plan.buckets[2]!.key, '2027-01');
});

test('负数和零金额不参与统计', () => {
  const plan = buildCashflow([entry('INFLOW', '2026-11-10', 0), entry('INFLOW', '2026-11-11', -500)], { asOf });
  assert.equal(plan.window.inflow, 0);
});

test('分期未收额不超过台账未收额时原样返回', () => {
  const rows = allocateScheduleOpen({
    totalOpen: 1_920_000,
    schedules: [{ id: 's1', amount: 4_920_000, allocated: 3_000_000 }],
  });
  assert.deepEqual(rows, [{ id: 's1', open: 1_920_000 }]);
});

test('分期未收额超过台账未收额时按比例摊薄，合计等于未收额', () => {
  const rows = allocateScheduleOpen({
    totalOpen: 379_500,
    schedules: [{ id: 's1', amount: 779_500, allocated: 400_000 }],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.open, 379_500);
});

test('多期摊薄后合计严格等于未收额（不因取整丢分）', () => {
  const rows = allocateScheduleOpen({
    totalOpen: 100,
    schedules: [
      { id: 'a', amount: 100, allocated: 0 },
      { id: 'b', amount: 100, allocated: 0 },
      { id: 'c', amount: 100, allocated: 0 },
    ],
  });
  const sum = rows.reduce((acc, row) => acc + Math.round(row.open * 100), 0);
  assert.equal(sum, 10_000);
});

test('已核销完的分期不返回', () => {
  const rows = allocateScheduleOpen({
    totalOpen: 500_000,
    schedules: [
      { id: 'done', amount: 300_000, allocated: 300_000 },
      { id: 'left', amount: 500_000, allocated: 0 },
    ],
  });
  assert.deepEqual(rows, [{ id: 'left', open: 500_000 }]);
});

test('没有分期或未收额为零时返回空数组', () => {
  assert.deepEqual(allocateScheduleOpen({ totalOpen: 0, schedules: [{ id: 'a', amount: 1, allocated: 0 }] }), []);
  assert.deepEqual(allocateScheduleOpen({ totalOpen: 100, schedules: [] }), []);
});

test('下钻明细合计与图表同月桶严格相等', () => {
  const entries: CashflowEntry[] = [
    entry('INFLOW', '2026-11-15', 1_000_000),
    entry('INFLOW', '2026-11-28', 500_000.5),
    entry('OUTFLOW', '2026-11-20', 800_000.25, 'PAYABLE'),
    entry('OUTFLOW', '2026-11-25', 300_000, 'PLAN'),
    entry('OUTFLOW', '2026-12-01', 9_999, 'PAYABLE'),
  ];
  const plan = buildCashflow(entries, { asOf });
  const bucket = plan.buckets[0]!;
  const slot = cashflowSlot(entries, { asOf, key: bucket.key });
  assert.equal(slot.items.length, 4);
  assert.equal(Math.round(slot.inflow * 100), Math.round(bucket.inflow * 100));
  assert.equal(Math.round(slot.outflow * 100), Math.round(bucket.outflow * 100));
  assert.equal(Math.round(slot.net * 100), Math.round(bucket.net * 100));
  // 明细分到分，不能因为浮点相加出现 0.01 的偏差
  assert.equal(Math.round(slot.inflow * 100), 150_000_050);
  assert.equal(Math.round(slot.outflow * 100), 110_000_025);
  assert.equal(slot.label, '11月');
});

test('下钻明细按先收后付、到期日升序排列', () => {
  const entries: CashflowEntry[] = [
    entry('OUTFLOW', '2026-11-05', 100, 'PAYABLE'),
    entry('INFLOW', '2026-11-20', 200),
    entry('INFLOW', '2026-11-03', 300),
  ];
  const slot = cashflowSlot(entries, { asOf, key: '2026-11' });
  assert.deepEqual(slot.items.map((item) => `${item.direction}:${item.amount}`), ['INFLOW:300', 'INFLOW:200', 'OUTFLOW:100']);
});

test('下钻可以取逾期、未设到期日、窗口以外三个非月份桶', () => {
  const entries: CashflowEntry[] = [
    entry('OUTFLOW', '2025-10-20', 1_920_000, 'PAYABLE'),
    entry('INFLOW', null, 6_000_000),
    entry('INFLOW', '2027-09-30', 900_000),
  ];
  const plan = buildCashflow(entries, { asOf });
  const overdue = cashflowSlot(entries, { asOf, key: 'overdue' });
  const unscheduled = cashflowSlot(entries, { asOf, key: 'unscheduled' });
  const beyond = cashflowSlot(entries, { asOf, key: 'beyond' });
  assert.equal(overdue.outflow, plan.overdue.outflow);
  assert.equal(overdue.label, '已逾期');
  assert.equal(unscheduled.inflow, plan.unscheduled.inflow);
  assert.equal(unscheduled.items[0]!.dueAt, null);
  assert.equal(beyond.inflow, plan.beyondWindow.inflow);
});

test('下钻带上原始单据线索，便于回查', () => {
  const entries: CashflowEntry[] = [{
    direction: 'INFLOW', dueAt: new Date('2026-11-10T00:00:00.000Z'), amount: 500_000, source: 'RECEIVABLE',
    ref: { id: 'rec-1', scheduleId: 'sch-2', title: '第 1 期进度款', sub: '应收单 YS-001 · 第 2 期' },
  }];
  const slot = cashflowSlot(entries, { asOf, key: '2026-11' });
  assert.deepEqual(slot.items[0]!.ref, { id: 'rec-1', scheduleId: 'sch-2', title: '第 1 期进度款', sub: '应收单 YS-001 · 第 2 期' });
});

test('空桶返回零合计而不是 null', () => {
  const slot = cashflowSlot([], { asOf, key: '2026-11' });
  assert.deepEqual(slot.items, []);
  assert.equal(slot.inflow, 0);
  assert.equal(slot.net, 0);
});
