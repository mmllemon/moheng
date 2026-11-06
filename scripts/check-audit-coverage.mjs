import { readFile } from 'node:fs/promises';
import { readModuleSources } from './lib/module-sources.mjs';
import { readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const read = (file) => readFile(join(root, file), 'utf8');
const routes = {
  projects: await read('apps/api/src/routes/projects.ts'),
  contracts: await read('apps/api/src/routes/contracts.ts'),
  budget: await read('apps/api/src/routes/budget.ts'),
  costs: await read('apps/api/src/routes/costs.ts'),
  progress: await read('apps/api/src/routes/progress-bills.ts'),
  changes: await read('apps/api/src/routes/changes.ts'),
  downstreamContracts: await read('apps/api/src/routes/downstream-contracts.ts'),
  downstreamFinance: await readModuleSources(root, 'apps/api/src/routes/downstream-finance.ts'),
  ownerFinance: await read('apps/api/src/routes/owner-finance.ts'),
  parties: await read('apps/api/src/routes/business-parties.ts'),
  auth: await read('apps/api/src/routes/auth.ts'),
  reports: await read('apps/api/src/routes/reports.ts'),
};
const rules = [
  ['项目创建/基本资料更新/成员角色变更', routes.projects.includes("entity: 'Project'") && routes.projects.includes("entity: 'ProjectMember'") && (routes.projects.match(/auditLog\.create/g) ?? []).length >= 3],
  ['业主主合同登记/更新', (routes.contracts.match(/auditLog\.create/g) ?? []).length >= 2],
  ['目标成本新增/修改/批量导入', (routes.budget.match(/auditLog\.create/g) ?? []).length >= 3 && routes.budget.includes('IMPORT_CSV') && routes.budget.includes('IMPORT_XLSX')],
  ['实际成本新增/合同关联修正/归档', (routes.costs.match(/auditLog\.create/g) ?? []).length >= 3],
  ['进度款新增/状态流转/到账', (routes.progress.match(/auditLog\.create/g) ?? []).length >= 5],
  ['变更签证创建/内部审批/外部确认/凭证核验/金额差异复核', (routes.changes.match(/auditLog\.create/g) ?? []).length >= 5 && routes.changes.includes('INTERNAL_AMOUNT_DISCREPANCY_REVIEW_COMPLETED')],
  ['分供合同创建/更新/状态变更/已签调整/付款计划/付款与退款', (routes.downstreamContracts.match(/auditLog\.create/g) ?? []).length >= 6 && routes.downstreamContracts.includes('PAYMENT_REFUND_RECORDED')],
  ['分供应付结算/过账/分期/发票核验/分配/质保金', routes.downstreamFinance.includes('async function writeAudit') && (routes.downstreamFinance.match(/writeAudit\(tx/g) ?? []).length >= 10],
  ['业主结算/过账/应收/到账退款/预付款/质保金/分期', routes.ownerFinance.includes('async function audit') && (routes.ownerFinance.match(/audit\(tx/g) ?? []).length >= 10],
  ['往来单位主数据新增/更新', (routes.parties.match(/auditLog\.create/g) ?? []).length >= 2],
  ['管理员创建账号', routes.auth.includes("entity: 'User'") && routes.auth.includes("action: 'USER_CREATED'")],
  ['报表模板创建/修改/发布/归档/历史恢复', routes.reports.includes('REPORT_TEMPLATE_CREATED') && routes.reports.includes('REPORT_TEMPLATE_UPDATED') && routes.reports.includes('REPORT_TEMPLATE_PUBLISHED') && routes.reports.includes('REPORT_TEMPLATE_ARCHIVED') && routes.reports.includes('REPORT_TEMPLATE_REVISION_RESTORED')],
];
let failed = 0;

/**
 * 审计动作的中文标签覆盖。
 *
 * 背景：2026-11-05 补质保金标签时发现，接口实际在用 89 个动作、审计页只映射了 32 个，
 * 其余在「操作追溯」里直接显示英文码。静态契约只能靠这条门禁维持。
 */
async function collectAuditActions() {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.ts') && !entry.name.includes('.test.')) files.push(full);
    }
  }
  await walk(join(root, 'apps/api/src'));
  const actions = new Set();
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/auditLog\.create\(\{[\s\S]{0,600}?action:\s*'([A-Z][A-Z0-9_]{4,})'/g)) actions.add(match[1]);
    // 助手函数是位置参数，动作码后面跟的是 changes 对象
    for (const match of source.matchAll(/'([A-Z][A-Z0-9_]{4,})'(?=\s*\)?\s*,\s*\{)/g)) actions.add(match[1]);
  }
  return actions;
}

const auditPage = await read('apps/web/src/pages/AuditLogsPage.tsx');
const labelBlock = auditPage.slice(auditPage.indexOf('const actionLabels'), auditPage.indexOf('};', auditPage.indexOf('const actionLabels')));
const labelledActions = new Set([...labelBlock.matchAll(/([A-Z][A-Z0-9_]{3,}):\s*'/g)].map((match) => match[1]));
const auditActions = await collectAuditActions();
const unlabelled = [...auditActions].filter((code) => !labelledActions.has(code)).sort();

rules.push(
  ['审计页动作标签覆盖全部后端审计动作', unlabelled.length === 0, unlabelled.length ? `缺标签：${unlabelled.join(', ')}` : ''],
  ['质保金四个动作与实体名有中文标签', ['RETENTION_RELEASED_TO_PAYABLE', 'RETENTION_FORFEITED', 'RETENTION_DEDUCTED', 'RETENTION_DEDUCTION_REVERSED'].every((code) => labelledActions.has(code)) && auditPage.includes("DownstreamRetentionMovement: '分供质保金'")],
);

for (const [label, ok, detail] of rules) {
  console.log(`${ok ? 'PASS' : 'FAIL'} audit coverage contract: ${label}${ok || !detail ? '' : `（${detail}）`}`);
  if (!ok) failed += 1;
}
console.log(`\n${rules.length - failed}/${rules.length} static audit coverage contracts passed.`);
if (failed) process.exitCode = 1;
