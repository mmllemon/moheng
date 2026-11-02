import { percentage } from '../components/Ui';
import type { ProjectEac } from '../types';

/**
 * 预计利润率下面那行口径说明。缺基准、缺样本、早期外推三种状态必须讲清楚，
 * 否则用户只能看到一个百分数，猜不出它从哪来、能不能信。
 */
export function eacCaption(eac: ProjectEac): string {
  if (eac.status === 'NO_BASELINE') return '先维护目标成本，才能给出完工预测';
  if (eac.status === 'READY') return `按业主核定产值折算 · 进度 ${percentage(eac.completionRatio)}${eac.caution ? ' · 早期外推，波动较大' : ''}`;
  if (eac.actualCost <= 0) return '还没有录入实际成本，无法折算成本效率';
  return `业主核定产值需达合同额 ${percentage(eac.minCompletionRatio)}，当前 ${percentage(eac.completionRatio)}`;
}
