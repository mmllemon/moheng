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
 *   4. 销项发票的税额（ownerInvoice.taxAmount），按开票月计入支出。
 *      建筑业先开票即纳税义务发生，钱没到税先交；但只计税额，
 *      票面金额已经包含在应收里，整张票再加一遍会把同一笔收入算两次。
 *
 * 没有到期日的金额不进曲线，单独统计，因为把它塞进某个月份等于编一个到期日。
 */

/** 曲线默认覆盖未来六个月（含当月）。 */
export const CASHFLOW_DEFAULT_MONTHS = 6;

export type CashflowDirection = 'INFLOW' | 'OUTFLOW';

/** 明细行指回原始台账的能力。buildCashflow 只关心金额与日期，ref 只用于下钻展示。 */
export type CashflowEntryRef = {
  /** 应收单 / 应付单 / 付款计划 / 销项发票的 id。 */
  id: string;
  /** 分期 id，有分期时指回具体一期。 */
  scheduleId?: string;
  /** 明细主标题，例如「锦澜花园二期住宅项目」。 */
  title: string;
  /** 明细副标题，例如「应付单 YS-0012 · 第 2 期」。 */
  sub?: string;
};

export type CashflowEntry = {
  direction: CashflowDirection;
  /** 到期日；为空表示台账里没有可靠日期。 */
  dueAt: Date | null;
  amount: number;
  source: 'RECEIVABLE' | 'PAYABLE' | 'PLAN' | 'INVOICE_TAX';
  ref?: CashflowEntryRef;
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

/** 窗口的三个非月份桶，键名与月份桶（YYYY-MM）互不冲突。 */
export const CASHFLOW_SLOT_OVERDUE = 'overdue';
export const CASHFLOW_SLOT_UNSCHEDULED = 'unscheduled';
export const CASHFLOW_SLOT_BEYOND = 'beyond';

type SlotContext = { todayStart: Date; windowEnd: Date; bucketKeys: Set<string> };

function slotContext(asOf: Date, months: number): SlotContext {
  const todayStart = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate());
  const windowEnd = new Date(asOf.getFullYear(), asOf.getMonth() + months, 1);
  const bucketKeys = new Set<string>();
  for (let index = 0; index < months; index += 1) bucketKeys.add(monthKey(new Date(asOf.getFullYear(), asOf.getMonth() + index, 1)));
  return { todayStart, windowEnd, bucketKeys };
}

/**
 * 把一笔金额归到具体的桶。图表与明细下钻必须共用这一个函数，
 * 否则同一个界面里“柱子的高度”和“点开的明细合计”会对不上。
 */
function slotOf(entry: CashflowEntry, context: SlotContext): string | null {
  if (toCents(entry.amount) <= 0n) return null;
  if (!entry.dueAt || Number.isNaN(entry.dueAt.getTime())) return CASHFLOW_SLOT_UNSCHEDULED;
  const due = new Date(entry.dueAt.getFullYear(), entry.dueAt.getMonth(), entry.dueAt.getDate());
  if (due.getTime() < context.todayStart.getTime()) return CASHFLOW_SLOT_OVERDUE;
  if (due.getTime() >= context.windowEnd.getTime()) return CASHFLOW_SLOT_BEYOND;
  const key = monthKey(due);
  return context.bucketKeys.has(key) ? key : CASHFLOW_SLOT_BEYOND;
}

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
  const context = slotContext(asOf, months);

  const bucketKeys: string[] = [];
  for (let index = 0; index < months; index += 1) bucketKeys.push(monthKey(new Date(asOf.getFullYear(), asOf.getMonth() + index, 1)));

  const accs = new Map<string, Accumulator>(bucketKeys.map((key) => [key, emptyAcc()]));
  const overdue = emptyAcc();
  const unscheduled = emptyAcc();
  const beyondWindow = emptyAcc();

  for (const entry of entries) {
    const slot = slotOf(entry, context);
    if (!slot) continue;
    const cents = toCents(entry.amount);
    if (slot === CASHFLOW_SLOT_OVERDUE) { add(overdue, entry.direction, cents); continue; }
    if (slot === CASHFLOW_SLOT_UNSCHEDULED) { add(unscheduled, entry.direction, cents); continue; }
    if (slot === CASHFLOW_SLOT_BEYOND) { add(beyondWindow, entry.direction, cents); continue; }
    const target = accs.get(slot);
    if (!target) { add(beyondWindow, entry.direction, cents); continue; }
    add(target, entry.direction, cents);
  }

  const buckets: CashflowBucket[] = bucketKeys.map((key) => ({
    key,
    label: `${Number(key.slice(5))}月`,
    ...totalsOf(accs.get(key) ?? emptyAcc()),
  }));
  const windowAcc = [...accs.values()].reduce<Accumulator>((acc, item) => ({ inflow: acc.inflow + item.inflow, outflow: acc.outflow + item.outflow }), emptyAcc());

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

export type CashflowSlotDetail = {
  key: string;
  label: string;
  inflow: number;
  outflow: number;
  net: number;
  /** 按方向、到期日、金额排序；合计与 buildCashflow 的同名桶严格相等。 */
  items: Array<{ direction: CashflowDirection; dueAt: string | null; amount: number; source: CashflowEntry['source']; ref?: CashflowEntryRef }>;
};

const SLOT_LABELS: Record<string, string> = {
  [CASHFLOW_SLOT_OVERDUE]: '已逾期',
  [CASHFLOW_SLOT_UNSCHEDULED]: '未设到期日',
  [CASHFLOW_SLOT_BEYOND]: '窗口以外',
};

const SLOT_ALIASES: Record<string, string> = { 逾期: CASHFLOW_SLOT_OVERDUE, 未设到期日: CASHFLOW_SLOT_UNSCHEDULED, 窗口外: CASHFLOW_SLOT_BEYOND };

/**
 * 下钻：把某一个桶拆成具体台账条目。
 *
 * key 取月份键（YYYY-MM）或 overdue / unscheduled / beyond。
 * 与 buildCashflow 共用 slotOf 与同一 params，因此拿到的明细合计一定等于图表上的那个数；
 * 调用方不需要、也不应该自己再按日期过滤一遍。
 */
export function cashflowSlot(entries: CashflowEntry[], options: { asOf: Date; months?: number; key: string }): CashflowSlotDetail {
  const months = Math.max(1, Math.min(24, Math.trunc(options.months ?? CASHFLOW_DEFAULT_MONTHS)));
  const context = slotContext(options.asOf, months);
  const requested = SLOT_ALIASES[options.key] ?? options.key;
  const acc = emptyAcc();
  const items: CashflowSlotDetail['items'] = [];
  for (const entry of entries) {
    if (slotOf(entry, context) !== requested) continue;
    const cents = toCents(entry.amount);
    add(acc, entry.direction, cents);
    items.push({
      direction: entry.direction,
      dueAt: entry.dueAt ? entry.dueAt.toISOString() : null,
      amount: fromCents(cents),
      source: entry.source,
      ...(entry.ref ? { ref: entry.ref } : {}),
    });
  }
  const order: Record<CashflowEntry['source'], number> = { RECEIVABLE: 0, PAYABLE: 1, PLAN: 2, INVOICE_TAX: 3 };
  items.sort((left, right) => {
    if (left.direction !== right.direction) return left.direction === 'INFLOW' ? -1 : 1;
    const leftDue = left.dueAt ?? '';
    const rightDue = right.dueAt ?? '';
    if (leftDue !== rightDue) return leftDue.localeCompare(rightDue);
    if (order[left.source] !== order[right.source]) return order[left.source] - order[right.source];
    return right.amount - left.amount;
  });
  const label = SLOT_LABELS[requested] ?? `${Number(requested.slice(5))}月`;
  return { key: requested, label, ...totalsOf(acc), items };
}
