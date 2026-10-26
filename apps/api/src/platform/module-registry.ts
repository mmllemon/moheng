import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import { analysisRoutes } from '../routes/analysis.js';
import { assistantPocRoutes } from '../routes/assistant-poc.js';
import { auditLogRoutes } from '../routes/audit-logs.js';
import { authRoutes } from '../routes/auth.js';
import { budgetRoutes } from '../routes/budget.js';
import { businessPartyRoutes } from '../routes/business-parties.js';
import { changeRoutes } from '../routes/changes.js';
import { contractRoutes } from '../routes/contracts.js';
import { configReadRoutes } from '../routes/config-read.js';
import { costRoutes } from '../routes/costs.js';
import { downstreamContractRoutes } from '../routes/downstream-contracts.js';
import { downstreamFinanceRoutes } from '../routes/downstream-finance.js';
import { notificationRoutes } from '../routes/notifications.js';
import { ownerFinanceRoutes } from '../routes/owner-finance.js';
import { progressBillRoutes } from '../routes/progress-bills.js';
import { projectRoutes } from '../routes/projects.js';
import { reportRoutes } from '../routes/reports.js';
import { reportStudioRoutes } from '../routes/report-studio.js';
import { systemManagementRoutes } from '../routes/system-management.js';
import { workspaceRoutes } from '../routes/workspace.js';
import { projectArtifactRoutes } from '../routes/project-artifacts.js';

/**
 * A registry for the modular monolith. Each module owns its route plugin and URL prefix;
 * it deliberately does not create a process, database, queue, or deployment boundary.
 */
export interface ApiModuleDefinition {
  id: string;
  name: string;
  description: string;
  mountPrefix: string;
  plugin: FastifyPluginAsync;
  integrationVisible: boolean;
}

export const apiModules = [
  { id: 'assistant-poc', name: '只读 AI 助手 PoC', description: '开发阶段只读工具验证，默认关闭且不对外公布为正式模块', mountPrefix: '/api/assistant-poc', plugin: assistantPocRoutes, integrationVisible: false },
  { id: 'auth', name: '身份认证', description: '登录、会话与访问凭证', mountPrefix: '/api/auth', plugin: authRoutes, integrationVisible: true },
  { id: 'projects', name: '项目管理', description: '项目档案、项目成员与项目范围权限', mountPrefix: '/api/projects', plugin: projectRoutes, integrationVisible: true },
  { id: 'workspace', name: '项目工作区', description: '项目目录树、文件预览、上传与删除', mountPrefix: '/api/projects', plugin: workspaceRoutes, integrationVisible: false },
  { id: 'project-artifacts', name: '项目产物', description: '变更单外部凭证附件的聚合列表与预览', mountPrefix: '/api/projects', plugin: projectArtifactRoutes, integrationVisible: false },
  { id: 'main-contracts', name: '业主主合同', description: '主合同档案与收入侧合同基础数据', mountPrefix: '/api/projects', plugin: contractRoutes, integrationVisible: true },
  { id: 'downstream-contracts', name: '分供合同', description: '分包、采购、租赁和服务合同及调整', mountPrefix: '/api/projects', plugin: downstreamContractRoutes, integrationVisible: true },
  { id: 'downstream-finance', name: '分供结算与应付', description: '分供结算、应付、付款、退款、发票与质保金', mountPrefix: '/api/projects', plugin: downstreamFinanceRoutes, integrationVisible: true },
  { id: 'owner-finance', name: '业主结算与应收', description: '业主竣工结算、应收及收退款', mountPrefix: '/api/projects', plugin: ownerFinanceRoutes, integrationVisible: true },
  { id: 'budget', name: '目标成本', description: '目标成本清单与 XLSX/CSV 数据交换', mountPrefix: '/api/projects', plugin: budgetRoutes, integrationVisible: true },
  { id: 'costs', name: '实际成本', description: '成本发生记录与合同关联', mountPrefix: '/api/projects', plugin: costRoutes, integrationVisible: true },
  { id: 'progress-bills', name: '业主进度款', description: '进度款申报、核定与到账记录', mountPrefix: '/api/projects', plugin: progressBillRoutes, integrationVisible: true },
  { id: 'changes', name: '变更签证', description: '内部审批、外部确认与凭证管理', mountPrefix: '/api/projects', plugin: changeRoutes, integrationVisible: true },
  { id: 'analysis', name: '成本分析', description: '项目经营指标与成本分析查询', mountPrefix: '/api', plugin: analysisRoutes, integrationVisible: true },
  { id: 'audit-logs', name: '操作审计', description: '授权范围内的操作追溯和审计导出', mountPrefix: '/api/audit-logs', plugin: auditLogRoutes, integrationVisible: true },
  { id: 'reports', name: '标准报表与模板', description: 'CSV/XLSX 台账、传统模板、预览和版本管理', mountPrefix: '/api/reports', plugin: reportRoutes, integrationVisible: true },
  { id: 'report-studio', name: '综合报表工作室', description: '项目级与公司级多数据源报表、单元格绑定、重复区域和 XLSX 预览导出', mountPrefix: '/api/reports/studio', plugin: reportStudioRoutes, integrationVisible: true },
  { id: 'notifications', name: '待办与预警', description: '根据现有业务台账动态计算待办和预警', mountPrefix: '/api/notifications', plugin: notificationRoutes, integrationVisible: true },
  { id: 'business-parties', name: '往来单位', description: '往来单位主数据与项目经营档案', mountPrefix: '/api/parties', plugin: businessPartyRoutes, integrationVisible: true },
  { id: 'system-config-read', name: '公共配置读取', description: '向已登录且有权访问的业务页面提供启用字典和已发布参数', mountPrefix: '/api/config', plugin: configReadRoutes, integrationVisible: false },
  { id: 'system-management', name: '系统管理扩展', description: '组织归属、版本化规则、统一字典/参数、运维灾备与集成凭据', mountPrefix: '/api/system-management', plugin: systemManagementRoutes, integrationVisible: false },
] satisfies readonly ApiModuleDefinition[];

export function getApiModuleCatalog() {
  return apiModules
    .filter((module) => module.integrationVisible)
    .map(({ id, name, description, mountPrefix }) => ({ id, name, description, mountPrefix, availability: 'available' as const }));
}

export async function registerApiModules(app: FastifyInstance): Promise<void> {
  for (const module of apiModules) {
    await app.register(module.plugin, { prefix: module.mountPrefix });
  }
}
