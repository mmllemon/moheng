/**
 * 资金计划（未来到期应收应付）。
 *
 * 这个模块只回答一个问题：按已经确定下来的到期日，未来几个月要收多少、要付多少、
 * 中间差多少。它不预测收款成功率，不把"计划中的合同额"混进已发生的付款义务。
 *
 * 三个金额来源，优先级和去重规则必须写清楚，否则很容易把同一笔钱算两遍：
 *   1. 应收未收（ownerReceivable 净额减已核销），按应收分期到期日；
 *   2. 应付未付（downstreamPayable 净额减已付款核销），按应付分期到期日；
 *   3. 付款计划（downstreamPaymentPlan 计划额减已付款），**只用于还没有应付的分供合同**。
 *      一旦合同已经结算出应付，付款计划就只是同一笔业务的另一层表达，不能再加一遍。
 *
 * 没有到期日的金额不进曲线，单独统计，因为把它塞进某个月份等于编一个到期日。
 */

/** 曲线默认覆盖未来六个月（含当月）。 */
export const CASHFLOW_DEFAULT_MONTHS = 6;

export type CashflowDirection = 'INFLOW' | 'OUTFLOW';

export type CashflowEntry = {
  direction: CashflowDirection;
  /** 到期日；为空表示台账里没有可靠日期。 */
  dueAt: Date | null;
  amount: number;
  source: 'RECEIVABLE' | 'PAYABLE' | 'PLAN';
};

export type CashflowBucket = {
  /** YYYY-MM */
  key: string;
  /** 展示用标签，例如 11月 */
  label: string;
  inflow: number;
  outflow: number;
  net: number;
};

export type CashflowTotals = { inflow: number; outflow: number; net: number };

export type CashflowPlan = {
  asOf: string;
  months: number;
  buckets: CashflowBucket[];
  overdue: CashflowTotals;
  /** 没有到期日、无法落入任何月份。 */
  unscheduled: CashflowTotals;
  /** 到期日在窗口之外。 */
  beyondWindow: CashflowTotals;
  /** 窗口内的合计。 */
  window: CashflowTotals;
};

const toCents = (value: number) => BigInt(Math.round((Number.isFinite(value) ? value : 0) * 100));
const fromCents = (value: bigint) => Number(value) / 100;

type Accumulator = { inflow: bigint; outflow: bigint };
const emptyAcc = (): Accumulator => ({ inflow: 0n, outflow: 0n });

function add(acc: Accumulator, direction: CashflowDirection, cents: bigint) {
  if (cents <= 0n) return;
  if (direction === 'INFLOW') acc.inflow += cents;
  else acc.outflow += cents;
}

function totalsOf(acc: Accumulator): CashflowTotals {
  return { inflow: fromCents(acc.inflow), outflow: fromCents(acc.outflow), net: fromCents(acc.inflow - acc.outflow) };
}

const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

/**
 * 把应收/应付的分期未收额按台账未收总额封顶。
 *
 * 分期金额之和可能大于台账未收额：到账记录未必指定期次，此时按比例摊薄，
 * 让每一期的到期金额加起来刚好等于未收余额，避免曲线把同一笔钱重复计入。
 */
export function allocateScheduleOpen(input: {
  totalOpen: number;
  schedules: Array<{ id: string; amount: number; allocated: number }>;
}): Array<{ id: string; open: number }> {
  const totalCents = toCents(input.totalOpen);
  if (totalCents <= 0n) return [];
  const raw = input.schedules.map((schedule) => ({
    id: schedule.id,
    open: toCents(schedule.amount) - toCents(schedule.allocated),
  })).filter((row) => row.open > 0n);
  if (!raw.length) return [];
  const sum = raw.reduce((acc, row) => acc + row.open, 0n);
  if (sum <= totalCents) return raw.map((row) => ({ id: row.id, open: fromCents(row.open) }));

  const scaled = raw.map((row) => ({ id: row.id, open: (row.open * totalCents) / sum }));
  // 整数除法会丢分，最后一项吸收余量，保证合计等于未收余额。
  const scaledSum = scaled.reduce((acc, row) => acc + row.open, 0n);
  const remainder = totalCents - scaledSum;
  if (remainder !== 0n) scaled[scaled.length - 1]!.open += remainder;
  return scaled.map((row) => ({ id: row.id, open: fromCents(row.open) }));
}

export function buildCashflow(entries: CashflowEntry[], options: { asOf: Date; months?: number }): CashflowPlan {
  const months = Math.max(1, Math.min(24, Math.trunc(options.months ?? CASHFLOW_DEFAULT_MONTHS)));
  const asOf = options.asOf;
  const todayStart = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const windowEnd = new Date(asOf.getFullYear(), asOf.getMonth() + months, 1);

  const bucketKeys: string[] = [];
  const bucketIndex = new Map<string, number>();
  for (let index = 0; index < months; index += 1) {
    const cursor = new Date(asOf.getFullYear(), asOf.getMonth() + index, 1);
    const key = monthKey(cursor);
    bucketKeys.push(key);
    bucketIndex.set(key, index);
  }

  const accs = bucketKeys.map(() => emptyAcc());
  const overdue = emptyAcc();
  const unscheduled = emptyAcc();
  const beyondWindow = emptyAcc();

  for (const entry of entries) {
    const cents = toCents(entry.amount);
    if (cents <= 0n) continue;
    if (!entry.dueAt || Number.isNaN(entry.dueAt.getTime())) { add(unscheduled, entry.direction, cents); continue; }
    const due = new Date(entry.dueAt.getFullYear(), entry.dueAt.getMonth(), entry.dueAt.getDate());
    if (due.getTime() < todayStart.getTime()) { add(overdue, entry.direction, cents); continue; }
    if (due.getTime() >= windowEnd.getTime()) { add(beyondWindow, entry.direction, cents); continue; }
    const index = bucketIndex.get(monthKey(due));
    const target = index === undefined ? undefined : accs[index];
    if (!target) { add(beyondWindow, entry.direction, cents); continue; }
    add(target, entry.direction, cents);
  }

  const buckets: CashflowBucket[] = bucketKeys.map((key, index) => ({
    key,
    label: `${Number(key.slice(5))}月`,
    ...totalsOf(accs[index] ?? emptyAcc()),
  }));
  const windowAcc = accs.reduce<Accumulator>((acc, acc2) => ({ inflow: acc.inflow + acc2.inflow, outflow: acc.outflow + acc2.outflow }), emptyAcc());

  return {
    asOf: asOf.toISOString(),
    months,
    buckets,
    overdue: totalsOf(overdue),
    unscheduled: totalsOf(unscheduled),
    beyondWindow: totalsOf(beyondWindow),
    window: totalsOf(windowAcc),
  };
}
