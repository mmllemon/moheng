/**
 * 完工估算（EAC，Estimate At Completion）。
 *
 * 系统里没有已完工程量，进度款也只有整期金额、没有清单明细，所以唯一独立于成本的
 * 进度信号是业主核定产值。据此用成本效率外推：
 *
 *   完成比 p = 累计核定产值 ÷ 当前有效合同额
 *   EAC     = 已发生成本 ÷ p
 *
 * 这个式子等价于 EAC = BAC / CPI（CPI 用产值代理挣值），含义是"剩余工作按已发生的
 * 成本效率继续"。它有两个已知偏差，方向一致，都会把 EAC 抬高：
 *   1. 产值月报滞后于成本发生，早期 p 偏小；
 *   2. 业主审减让 p 偏小。
 * 因此 p 太小时不给单点，只报"数据不足"。给数时同时算两种假设：当前效率延续，
 * 或剩余工作回到目标成本，取两者构成区间，再叠加已提交未确认签证的敞口作为上限。
 *
 * 这里只做统计式外推。自下而上的 ETC（分包合同剩余承诺 + 自有部分剩余）不在本模块，
 * 因为两者相加需要先解决清单项与分供合同的覆盖关系。
 */

/** 低于这个完成比，样本太小，外推结果在数量级上不可信。 */
export const EAC_MIN_COMPLETION_RATIO = 0.15;
/** 15% 到 30% 之间可以给数，但要提示是早期外推。 */
export const EAC_CAUTION_COMPLETION_RATIO = 0.3;

export type ProjectEacStatus = 'READY' | 'INSUFFICIENT_DATA' | 'NO_BASELINE';

export type ProjectEacRange = { low: number; likely: number; high: number };

export type ProjectEac = {
  status: ProjectEacStatus;
  /** 使用中的方法；没有预测时为空。 */
  method: 'CERTIFIED_REVENUE_RATIO' | null;
  /** 完工预算（目标成本基线），没有维护时为空。 */
  budgetAtCompletion: number | null;
  actualCost: number;
  /** 累计业主核定产值，用作进度信号的分子。 */
  certifiedRevenue: number;
  /** 已提交或审核中变更的申报额，只作为悲观档的附加敞口。 */
  pendingChangeExposure: number;
  /** 产值完成比，0 到 1 以上；无法计算时为空。 */
  completionRatio: number | null;
  /** 给出预测所需的最低完成比，用于界面文案。 */
  minCompletionRatio: number;
  /** 完成比仍处于早期区间，结果波动大。 */
  caution: boolean;
  /** 完工预计成本区间：低值取两种效率假设中较小者，高值再叠加未确认变更敞口。 */
  valuation: ProjectEacRange | null;
  /** 剩余工作按目标成本效率执行时的对照值，与 valuation.likely 并列展示两种假设。 */
  budgetEfficiencyCost: number | null;
  /** 对应的预计利润率三档，无法预测时为空。 */
  margin: ProjectEacRange | null;
};

export type ProjectEacInput = {
  contractAmount: number;
  budgetAtCompletion: number;
  actualCost: number;
  certifiedRevenue: number;
  pendingChangeExposure?: number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;
const round4 = (value: number) => Math.round(value * 10000) / 10000;
const positive = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? round2(parsed) : 0;
};

export function computeProjectEac(input: ProjectEacInput): ProjectEac {
  const contractAmount = positive(input.contractAmount);
  const budgetAtCompletion = positive(input.budgetAtCompletion);
  const actualCost = positive(input.actualCost);
  const certifiedRevenue = positive(input.certifiedRevenue);
  const pendingChangeExposure = positive(input.pendingChangeExposure);

  const base: Omit<ProjectEac, 'status' | 'method' | 'budgetAtCompletion' | 'completionRatio' | 'caution' | 'valuation' | 'budgetEfficiencyCost' | 'margin'> = {
    actualCost,
    certifiedRevenue,
    pendingChangeExposure,
    minCompletionRatio: EAC_MIN_COMPLETION_RATIO,
  };

  // 没有合同额或没有目标成本基线，进度与成本都没有可对照的分母。
  if (contractAmount <= 0 || budgetAtCompletion <= 0) {
    return {
      ...base,
      status: 'NO_BASELINE',
      method: null,
      budgetAtCompletion: budgetAtCompletion > 0 ? budgetAtCompletion : null,
      completionRatio: null,
      caution: false,
      valuation: null,
      budgetEfficiencyCost: null,
      margin: null,
    };
  }

  const completionRatio = round4(certifiedRevenue / contractAmount);
  // 有产值却没有任何成本，说明成本尚未录入；此时外推得到 0 成本、100% 利润，比不给数更误导。
  if (actualCost <= 0 || certifiedRevenue <= 0 || completionRatio < EAC_MIN_COMPLETION_RATIO) {
    return {
      ...base,
      status: 'INSUFFICIENT_DATA',
      method: null,
      budgetAtCompletion,
      completionRatio,
      caution: false,
      valuation: null,
      budgetEfficiencyCost: null,
      margin: null,
    };
  }

  // 两种效率假设分别算一遍：当前效率延续，或剩余工作回到目标成本。两者谁高谁低
  // 取决于已完成部分的成本效率，所以不给它们贴乐观/悲观标签，直接按假设命名。
  const workedRatio = Math.min(1, Math.max(0, completionRatio));
  const currentCost = Math.max(actualCost, round2(actualCost / Math.min(1, completionRatio)));
  const budgetCost = round2(actualCost + budgetAtCompletion * (1 - workedRatio));
  const low = Math.min(currentCost, budgetCost);
  const high = round2(Math.max(currentCost, budgetCost) + pendingChangeExposure);
  const valuation: ProjectEacRange = { low, likely: currentCost, high };
  const marginOf = (cost: number) => round4((contractAmount - cost) / contractAmount);

  return {
    ...base,
    status: 'READY',
    method: 'CERTIFIED_REVENUE_RATIO',
    budgetAtCompletion,
    completionRatio,
    caution: completionRatio < EAC_CAUTION_COMPLETION_RATIO,
    valuation,
    budgetEfficiencyCost: budgetCost,
    margin: { low: marginOf(high), likely: marginOf(currentCost), high: marginOf(low) },
  };
}
