import { readFile } from 'node:fs/promises';
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
  downstreamFinance: await read('apps/api/src/routes/downstream-finance.ts'),
  ownerFinance: await read('apps/api/src/routes/owner-finance.ts'),
  parties: await read('apps/api/src/routes/business-parties.ts'),
  auth: await read('apps/api/src/routes/auth.ts'),
};
const rules = [
  ['项目创建/基本资料更新/成员角色变更', routes.projects.includes("entity: 'Project'") && routes.projects.includes("entity: 'ProjectMember'") && (routes.projects.match(/auditLog\.create/g) ?? []).length >= 3],
  ['业主主合同登记/更新', (routes.contracts.match(/auditLog\.create/g) ?? []).length >= 2],
  ['目标成本新增/修改/批量导入', (routes.budget.match(/auditLog\.create/g) ?? []).length >= 3 && routes.budget.includes("action: 'IMPORT_CSV'")],
  ['实际成本新增/合同关联修正/归档', (routes.costs.match(/auditLog\.create/g) ?? []).length >= 3],
  ['进度款新增/状态流转/到账', (routes.progress.match(/auditLog\.create/g) ?? []).length >= 5],
  ['变更签证创建/内部审批/外部确认/凭证核验/金额差异复核', (routes.changes.match(/auditLog\.create/g) ?? []).length >= 5 && routes.changes.includes('INTERNAL_AMOUNT_DISCREPANCY_REVIEW_COMPLETED')],
  ['分供合同创建/更新/状态变更/已签调整/付款计划/付款与退款', (routes.downstreamContracts.match(/auditLog\.create/g) ?? []).length >= 6 && routes.downstreamContracts.includes('PAYMENT_REFUND_RECORDED')],
  ['分供应付结算/过账/分期/发票核验/分配/质保金', routes.downstreamFinance.includes('async function writeAudit') && (routes.downstreamFinance.match(/writeAudit\(tx/g) ?? []).length >= 10],
  ['业主结算/过账/应收/到账退款/预付款/质保金/分期', routes.ownerFinance.includes('async function audit') && (routes.ownerFinance.match(/audit\(tx/g) ?? []).length >= 10],
  ['往来单位主数据新增/更新', (routes.parties.match(/auditLog\.create/g) ?? []).length >= 2],
  ['管理员创建账号', routes.auth.includes("entity: 'User'") && routes.auth.includes("action: 'USER_CREATED'")],
];
let failed = 0;
for (const [label, ok] of rules) {
  console.log(`${ok ? 'PASS' : 'FAIL'} audit coverage contract: ${label}`);
  if (!ok) failed += 1;
}
console.log(`\n${rules.length - failed}/${rules.length} static audit coverage contracts passed.`);
if (failed) process.exitCode = 1;
