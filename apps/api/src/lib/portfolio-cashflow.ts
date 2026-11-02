/**
 * 公司级资金计划聚合。
 *
 * 项目之间没有共享的应收应付，所以窗口内的金额可以直接相加，不需要像项目内
 * 那样做去重。真正要小心的是三件事：
 *   1. 分桶必须按月份键对齐。不同项目算出来的 buckets 顺序一致，但不能假设，
 *      所以要按 key 归并、缺失的月份补 0；
 *   2. 只加「窗口内」的数。逾期、未设到期日、窗口之外单独相加，不能混进月份，
 *      否则公司层面的缺口会被历史欠款撑大；
 *   3. 金额用分累加，避免 0.1 + 0.2 这类浮点误差在汇总时放大。
 */
import type { CashflowBucket, CashflowPlan, CashflowTotals } from './cashflow.js';

const toCents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
const fromCents = (value: number) => value / 100;

type TotalsAcc = { inflow: number; outflow: number };
const emptyAcc = (): TotalsAcc => ({ inflow: 0, outflow: 0 });

function accumulate(target: TotalsAcc, source: CashflowTotals) {
  target.inflow += toCents(source.inflow);
  target.outflow += toCents(source.outflow);
}

function totalsOf(acc: TotalsAcc): CashflowTotals {
  return { inflow: fromCents(acc.inflow), outflow: fromCents(acc.outflow), net: fromCents(acc.inflow - acc.outflow) };
}

export type PortfolioProjectInput = {
  projectId: string;
  name: string;
  code: string;
  plan: CashflowPlan;
  invoiceTax: { count: number; amount: number };
  uncovered: {
    receivableWithoutDueDate: number;
    payableWithoutDueDate: number;
    unplannedContractCount: number;
    unplannedContractAmount: number;
  };
};

export type PortfolioProjectRow = PortfolioProjectInput & { window: CashflowTotals; overdue: CashflowTotals; unscheduled: CashflowTotals; beyondWindow: CashflowTotals };

export type PortfolioCashflow = {
  asOf: string;
  months: number;
  buckets: CashflowBucket[];
  window: CashflowTotals;
  overdue: CashflowTotals;
  unscheduled: CashflowTotals;
  beyondWindow: CashflowTotals;
  invoiceTax: { count: number; amount: number };
  uncovered: {
    receivableWithoutDueDate: number;
    payableWithoutDueDate: number;
    unplannedContractCount: number;
    unplannedContractAmount: number;
  };
  /** 按窗口净额升序（缺口最大的排最前），同额按名称。 */
  projects: PortfolioProjectRow[];
};

export function aggregatePortfolioCashflows(projects: PortfolioProjectInput[], asOf: Date): PortfolioCashflow {
  const windowAcc = emptyAcc();
  const overdueAcc = emptyAcc();
  const unscheduledAcc = emptyAcc();
  const beyondAcc = emptyAcc();
  const bucketAcc = new Map<string, TotalsAcc>();
  let invoiceTaxCount = 0;
  let invoiceTaxCents = 0;
  let receivableWithoutDueDate = 0;
  let payableWithoutDueDate = 0;
  let unplannedContractCount = 0;
  let unplannedContractCents = 0;
  const months = projects.reduce((max, project) => Math.max(max, project.plan.buckets.length), 0);

  for (const project of projects) {
    accumulate(windowAcc, project.plan.window);
    accumulate(overdueAcc, project.plan.overdue);
    accumulate(unscheduledAcc, project.plan.unscheduled);
    accumulate(beyondAcc, project.plan.beyondWindow);
    for (const bucket of project.plan.buckets) {
      const target = bucketAcc.get(bucket.key) ?? emptyAcc();
      accumulate(target, bucket);
      bucketAcc.set(bucket.key, target);
    }
    invoiceTaxCount += project.invoiceTax.count;
    invoiceTaxCents += toCents(project.invoiceTax.amount);
    receivableWithoutDueDate += project.uncovered.receivableWithoutDueDate;
    payableWithoutDueDate += project.uncovered.payableWithoutDueDate;
    unplannedContractCount += project.uncovered.unplannedContractCount;
    unplannedContractCents += toCents(project.uncovered.unplannedContractAmount);
  }

  const buckets: CashflowBucket[] = [...bucketAcc.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, acc]) => ({ key, label: `${Number(key.slice(5))}月`, ...totalsOf(acc) }));

  const rows: PortfolioProjectRow[] = projects
    .map((project) => ({
      ...project,
      window: project.plan.window,
      overdue: project.plan.overdue,
      unscheduled: project.plan.unscheduled,
      beyondWindow: project.plan.beyondWindow,
    }))
    .sort((left, right) => (toCents(left.window.net) - toCents(right.window.net)) || left.name.localeCompare(right.name, 'zh-CN'));

  return {
    asOf: asOf.toISOString(),
    months,
    buckets,
    window: totalsOf(windowAcc),
    overdue: totalsOf(overdueAcc),
    unscheduled: totalsOf(unscheduledAcc),
    beyondWindow: totalsOf(beyondAcc),
    invoiceTax: { count: invoiceTaxCount, amount: fromCents(invoiceTaxCents) },
    uncovered: {
      receivableWithoutDueDate,
      payableWithoutDueDate,
      unplannedContractCount,
      unplannedContractAmount: fromCents(unplannedContractCents),
    },
    projects: rows,
  };
}
