import type { ProjectRole } from '@prisma/client';

export const PROJECT_PERMISSION_BASELINES = {
  PROJECT_READ: ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER'],
  PROJECT_MANAGE: ['OWNER', 'MANAGER'],
  TARGET_COST_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  ACTUAL_COST_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  ACTUAL_COST_ADMIN: ['OWNER', 'MANAGER'],
  MAIN_CONTRACT_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  DOWNSTREAM_CONTRACT_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  DOWNSTREAM_CONTRACT_ADMIN: ['OWNER', 'MANAGER'],
  DOWNSTREAM_FINANCE_WRITE: ['OWNER', 'MANAGER'],
  OWNER_FINANCE_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  PROGRESS_BILL_WRITE: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  CHANGE_SUBMIT: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  CHANGE_APPROVE: ['OWNER', 'MANAGER'],
  CHANGE_EXTERNAL_CONFIRM: ['OWNER', 'MANAGER', 'ESTIMATOR'],
  CHANGE_EVIDENCE_VERIFY: ['OWNER', 'MANAGER'],
  REPORT_EXPORT: ['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER'],
} as const satisfies Record<string, readonly ProjectRole[]>;

export type ProjectPermissionKey = keyof typeof PROJECT_PERMISSION_BASELINES;
export type ProjectPermissionPolicy = Record<ProjectPermissionKey, ProjectRole[]>;

export const PROJECT_PERMISSION_LABELS: Record<ProjectPermissionKey, { label: string; description: string }> = {
  PROJECT_READ: { label: '项目读取', description: '进入项目与查看有权访问的业务数据' },
  PROJECT_MANAGE: { label: '项目管理', description: '项目资料、成员和项目级治理操作' },
  TARGET_COST_WRITE: { label: '目标成本维护', description: '目标成本清单录入、修改与导入' },
  ACTUAL_COST_WRITE: { label: '实际成本维护', description: '实际成本新增、修改及合同关联' },
  ACTUAL_COST_ADMIN: { label: '实际成本管理', description: '归档等高风险成本管理操作' },
  MAIN_CONTRACT_WRITE: { label: '业主主合同维护', description: '主合同资料及允许范围内的合同更新' },
  DOWNSTREAM_CONTRACT_WRITE: { label: '分供合同维护', description: '分包、采购、租赁等合同档案维护' },
  DOWNSTREAM_CONTRACT_ADMIN: { label: '分供合同管理', description: '分供合同状态、调整等高风险动作' },
  DOWNSTREAM_FINANCE_WRITE: { label: '分供结算与应付', description: '结算、过账、应付、付款及退款' },
  OWNER_FINANCE_WRITE: { label: '业主结算与应收', description: '竣工结算、应收、收款及退款' },
  PROGRESS_BILL_WRITE: { label: '业主进度款维护', description: '进度款申报、核定与到账台账操作' },
  CHANGE_SUBMIT: { label: '变更签证提交', description: '变更资料新增与提交' },
  CHANGE_APPROVE: { label: '变更签证内部审批', description: '内部复核、确认或驳回；仍禁止提交人自审批' },
  CHANGE_EXTERNAL_CONFIRM: { label: '外部确认登记', description: '登记业主/授权代表外部确认凭证，不替代内部审批' },
  CHANGE_EVIDENCE_VERIFY: { label: '变更凭证核验', description: '核验外部确认凭证与相关证据' },
  REPORT_EXPORT: { label: '报表导出', description: '在既有数据读取权限内导出项目报表' },
};

const roles = new Set<ProjectRole>(['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']);

export function defaultProjectPermissionPolicy(): ProjectPermissionPolicy {
  return Object.fromEntries(Object.entries(PROJECT_PERMISSION_BASELINES).map(([key, value]) => [key, [...value]])) as ProjectPermissionPolicy;
}

export function parseProjectPermissionPolicy(value: unknown): ProjectPermissionPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const expected = Object.keys(PROJECT_PERMISSION_BASELINES);
  if (Object.keys(record).some((key) => !expected.includes(key))) return null;
  const policy = defaultProjectPermissionPolicy();
  for (const key of expected as ProjectPermissionKey[]) {
    const raw = record[key];
    if (raw === undefined) continue;
    if (!Array.isArray(raw) || raw.some((role) => typeof role !== 'string' || !roles.has(role as ProjectRole))) return null;
    const baseline = PROJECT_PERMISSION_BASELINES[key] as readonly ProjectRole[];
    if (raw.some((role) => !baseline.includes(role as ProjectRole))) return null;
    if (new Set(raw).size !== raw.length) return null;
    policy[key] = [...raw] as ProjectRole[];
  }
  return policy;
}

export function projectPermissionPolicyForRuntime(value: unknown): ProjectPermissionPolicy | null {
  return parseProjectPermissionPolicy(value);
}
