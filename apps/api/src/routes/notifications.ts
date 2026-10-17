import type { FastifyInstance } from 'fastify';
import { authRequired, authUser } from '../lib/auth.js';
import { failure, success } from '../lib/http.js';
import { prisma } from '../lib/prisma.js';
import { businessNumberParameter, loadBusinessNumberParameters } from '../lib/business-parameters.js';
import { hasCrossProjectReadScope } from '../lib/project-data-scope.js';

const warningDefinitions = {
  CONTRACT_EXPIRY_WARNING_DAYS: { defaultValue: 30, min: 1, max: 365 },
  TARGET_COST_OVERRUN_DANGER_PERCENT: { defaultValue: 0, min: 0, max: 100 },
} as const;

function openAmount(netAmount: unknown, allocations: { amount: unknown }[]) {
  return Number(netAmount ?? 0) - allocations.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
}

export async function notificationRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: authRequired }, async (request, reply) => {
    const user = authUser(request);
    const canReadAllProjects = user.role === 'ADMIN' || await hasCrossProjectReadScope(user.sub, user.role, 'PROJECT_READ');
    const query = await prisma.project.findMany({
      where: { deletedAt: null, ...(canReadAllProjects ? {} : { members: { some: { userId: user.sub } } }) },
      select: { id: true, name: true, code: true }, orderBy: { code: 'asc' },
    });
    const ids = query.map((project) => project.id);
    if (!ids.length) return success({ generatedAt: new Date().toISOString(), total: 0, bySeverity: { danger: 0, warning: 0, info: 0 }, items: [] });
    const projectMap = new Map(query.map((project) => [project.id, project]));
    const now = new Date();
    const warningParameters = await loadBusinessNumberParameters(ids, warningDefinitions);
    const expiryDaysFor = (projectId: string) => businessNumberParameter(warningParameters, 'CONTRACT_EXPIRY_WARNING_DAYS', projectId, warningDefinitions.CONTRACT_EXPIRY_WARNING_DAYS);
    const maxExpiryDays = Math.max(...ids.map(expiryDaysFor), warningDefinitions.CONTRACT_EXPIRY_WARNING_DAYS.defaultValue);
    const soon = new Date(now.getTime() + maxExpiryDays * 24 * 60 * 60 * 1000);
    const [pendingChanges, pendingEvidence, pendingBills, overdueReceivables, overduePayableSchedules, pendingSettlements, expiringContracts, budgetItems, costEntries] = await Promise.all([
      prisma.change.findMany({ where: { projectId: { in: ids }, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { id: true, projectId: true, code: true, name: true, status: true, submittedAmount: true, occurredAt: true }, orderBy: { updatedAt: 'asc' }, take: 250 }),
      prisma.change.findMany({ where: { projectId: { in: ids }, deletedAt: null, externalConfirmationStatus: { in: ['PENDING_SUPPLEMENT', 'PENDING_VERIFICATION', 'DISPUTED'] } }, select: { id: true, projectId: true, code: true, name: true, externalConfirmationStatus: true, evidenceClass: true, externalConfirmerName: true }, orderBy: { updatedAt: 'asc' }, take: 250 }),
      prisma.progressBill.findMany({ where: { projectId: { in: ids }, deletedAt: null, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }, select: { id: true, projectId: true, periodNo: true, amount: true, applyDate: true, status: true }, orderBy: { applyDate: 'asc' }, take: 250 }),
      prisma.ownerReceivable.findMany({ where: { projectId: { in: ids }, status: { in: ['OPEN', 'PARTIALLY_RECEIVED'] }, dueAt: { lt: now } }, include: { allocations: { select: { amount: true } } }, orderBy: { dueAt: 'asc' }, take: 500 }),
      prisma.downstreamPayableSchedule.findMany({ where: { dueAt: { lt: now }, payable: { downstreamContract: { projectId: { in: ids }, deletedAt: null } } }, include: { allocations: { select: { amount: true } }, payable: { include: { downstreamContract: { select: { id: true, projectId: true, contractNo: true, name: true, counterpartyName: true } } } } }, orderBy: { dueAt: 'asc' }, take: 500 }),
      prisma.downstreamContractSettlement.findMany({ where: { downstreamContract: { projectId: { in: ids }, deletedAt: null }, status: { in: ['SUBMITTED', 'INTERNAL_APPROVED', 'COUNTERPARTY_CONFIRMED'] } }, include: { downstreamContract: { select: { projectId: true, contractNo: true, name: true, counterpartyName: true } } }, orderBy: { updatedAt: 'asc' }, take: 250 }),
      prisma.downstreamContract.findMany({ where: { projectId: { in: ids }, deletedAt: null, status: 'ACTIVE', plannedEndDate: { gte: now, lte: soon } }, select: { id: true, projectId: true, contractNo: true, name: true, counterpartyName: true, plannedEndDate: true }, orderBy: { plannedEndDate: 'asc' }, take: 250 }),
      prisma.budgetItem.findMany({ where: { projectId: { in: ids }, deletedAt: null }, select: { id: true, projectId: true, parentId: true, totalPrice: true } }),
      prisma.costEntry.groupBy({ by: ['projectId'], where: { projectId: { in: ids }, deletedAt: null }, _sum: { amount: true } }),
    ]);

    const items: Array<{ id: string; kind: string; severity: 'danger' | 'warning' | 'info'; title: string; description: string; projectId: string; projectName: string; projectCode: string; occurredAt: string; href: string; amount?: number }> = [];
    for (const row of pendingChanges) {
      const p = projectMap.get(row.projectId); if (!p) continue;
      items.push({ id: `change-approval:${row.id}`, kind: 'CHANGE_APPROVAL', severity: 'warning', title: `变更待内部处理：${row.code}`, description: `${row.name} · ${row.status === 'SUBMITTED' ? '待进入审核' : '待完成内部审批'}`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: row.occurredAt.toISOString(), href: `/workspace/changes`, amount: Number(row.submittedAmount) });
    }
    for (const row of pendingEvidence) {
      const p = projectMap.get(row.projectId); if (!p) continue;
      const title = row.externalConfirmationStatus === 'PENDING_VERIFICATION' ? '外部确认凭证待独立核验' : row.externalConfirmationStatus === 'PENDING_SUPPLEMENT' ? '外部确认资料待补充' : '外部确认存在争议';
      items.push({ id: `change-evidence:${row.id}`, kind: 'CHANGE_EVIDENCE', severity: row.externalConfirmationStatus === 'DISPUTED' ? 'danger' : 'warning', title: `${title}：${row.code}`, description: `${row.name} · ${row.evidenceClass ? `${row.evidenceClass} 类凭证` : '未登记凭证类别'}${row.externalConfirmerName ? ` · ${row.externalConfirmerName}` : ''}`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: now.toISOString(), href: '/workspace/changes' });
    }
    for (const row of pendingBills) {
      const p = projectMap.get(row.projectId); if (!p) continue;
      items.push({ id: `progress-bill:${row.id}`, kind: 'PROGRESS_BILL', severity: 'info', title: `业主进度款待处理：第 ${row.periodNo} 期`, description: `申报金额 ${Number(row.amount).toFixed(2)} 元 · ${row.status === 'SUBMITTED' ? '等待审核' : '等待审批结果'}`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: row.applyDate.toISOString(), href: '/workspace/progress-bills', amount: Number(row.amount) });
    }
    for (const row of overdueReceivables) {
      const open = openAmount(row.netAmount, row.allocations); if (open <= 0.005) continue;
      const p = projectMap.get(row.projectId); if (!p) continue;
      items.push({ id: `owner-receivable:${row.id}`, kind: 'OVERDUE_RECEIVABLE', severity: 'danger', title: `业主应收已逾期：${row.receivableNo}`, description: `${row.title} · 到期日 ${row.dueAt?.toISOString().slice(0, 10) ?? '未设定'} · 未收 ${open.toFixed(2)} 元`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: (row.dueAt ?? row.postedAt).toISOString(), href: '/workspace/owner-finance', amount: open });
    }
    for (const row of overduePayableSchedules) {
      const open = Number(row.amount) - row.allocations.reduce((sum, allocation) => sum + Number(allocation.amount), 0); if (open <= 0.005) continue;
      const contract = row.payable.downstreamContract; const p = projectMap.get(contract.projectId); if (!p) continue;
      items.push({ id: `downstream-payable:${row.id}`, kind: 'OVERDUE_PAYABLE', severity: 'danger', title: `分供应付计划已逾期：${row.scheduleNo}`, description: `${contract.contractNo} · ${contract.counterpartyName} · 未核销 ${open.toFixed(2)} 元`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: row.dueAt.toISOString(), href: '/workspace/downstream?view=finance', amount: open });
    }
    for (const row of pendingSettlements) {
      const p = projectMap.get(row.downstreamContract.projectId); if (!p) continue;
      const label = row.status === 'SUBMITTED' ? '待内部审核' : row.status === 'INTERNAL_APPROVED' ? '待相对方确认' : '待过账';
      items.push({ id: `downstream-settlement:${row.id}`, kind: 'DOWNSTREAM_SETTLEMENT', severity: 'warning', title: `分供结算${label}：${row.settlementNo}`, description: `${row.downstreamContract.name} · ${row.downstreamContract.counterpartyName}`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: row.updatedAt.toISOString(), href: '/workspace/downstream?view=finance', amount: Number(row.confirmedAmount ?? row.submittedAmount) });
    }
    for (const row of expiringContracts) {
      const p = projectMap.get(row.projectId); if (!p) continue;
      const days = expiryDaysFor(row.projectId);
      if (row.plannedEndDate && row.plannedEndDate.getTime() > now.getTime() + days * 24 * 60 * 60 * 1000) continue;
      items.push({ id: `contract-expiring:${row.id}`, kind: 'CONTRACT_EXPIRING', severity: 'info', title: `分供合同即将到期：${row.contractNo}`, description: `${row.name} · ${row.counterpartyName} · 计划结束 ${row.plannedEndDate?.toISOString().slice(0, 10) ?? '未填写'}`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: row.plannedEndDate?.toISOString() ?? now.toISOString(), href: '/workspace/downstream' });
    }
    // Match the project budget view's leaf-only baseline; only alert where a positive
    // baseline exists, and compare against actual cost records for that same project.
    const parentItemIds = new Set(budgetItems.map((item) => item.parentId).filter((id): id is string => Boolean(id)));
    const targetByProject = new Map<string, number>();
    for (const item of budgetItems) {
      if (parentItemIds.has(item.id)) continue;
      targetByProject.set(item.projectId, (targetByProject.get(item.projectId) ?? 0) + Number(item.totalPrice));
    }
    const actualByProject = new Map<string, number>();
    for (const entry of costEntries) actualByProject.set(entry.projectId, Number(entry._sum.amount ?? 0));
    for (const [projectId, targetCost] of targetByProject) {
      if (!(targetCost > 0)) continue;
      const actualCost = actualByProject.get(projectId) ?? 0;
      if (actualCost <= targetCost) continue;
      const p = projectMap.get(projectId); if (!p) continue;
      const overrun = actualCost - targetCost;
      const overrunPercent = (overrun / targetCost) * 100;
      const dangerThreshold = businessNumberParameter(warningParameters, 'TARGET_COST_OVERRUN_DANGER_PERCENT', projectId, warningDefinitions.TARGET_COST_OVERRUN_DANGER_PERCENT);
      items.push({ id: `target-cost-overrun:${projectId}`, kind: 'TARGET_COST_OVERRUN', severity: overrunPercent >= dangerThreshold ? 'danger' : 'warning', title: `实际成本超过目标成本：${p.code}`, description: `目标成本 ${targetCost.toFixed(2)} 元 · 实际成本 ${actualCost.toFixed(2)} 元 · 超出 ${overrun.toFixed(2)} 元（${overrunPercent.toFixed(1)}%）`, projectId: p.id, projectName: p.name, projectCode: p.code, occurredAt: now.toISOString(), href: '/workspace/analysis', amount: overrun });
    }
    const severityRank = { danger: 0, warning: 1, info: 2 };
    items.sort((a, b) => severityRank[a.severity] - severityRank[b.severity] || new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const limited = items.slice(0, 1000);
    return success({ generatedAt: now.toISOString(), total: limited.length, bySeverity: { danger: limited.filter(i => i.severity === 'danger').length, warning: limited.filter(i => i.severity === 'warning').length, info: limited.filter(i => i.severity === 'info').length }, items: limited });
  });
}
