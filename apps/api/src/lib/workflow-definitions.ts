import type { ProjectRole } from '@prisma/client';
import { moneyToCents } from './contract-amount-math.js';

export type ChangeWorkflowStatus = 'DRAFT' | 'SUBMITTED' | 'UNDER_REVIEW' | 'CONFIRMED' | 'REJECTED';
export type WorkflowCondition = { field: 'submittedAmount'; op: 'LTE' | 'GT'; value: string };
export type WorkflowTransitionDefinition = {
  from: ChangeWorkflowStatus;
  to: ChangeWorkflowStatus;
  allowedProjectRoles: ProjectRole[];
  selfApprovalForbidden: boolean;
  condition?: WorkflowCondition;
};
export type WorkflowDefinition = { states: ChangeWorkflowStatus[]; transitions: WorkflowTransitionDefinition[] };
const validStates = new Set<ChangeWorkflowStatus>(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED']);
const validRoles = new Set<ProjectRole>(['OWNER', 'MANAGER', 'ESTIMATOR', 'VIEWER']);

export function parseWorkflowDefinition(value: unknown): WorkflowDefinition | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.states) || !Array.isArray(raw.transitions) || raw.states.length < 2 || raw.states.length > 5 || raw.transitions.length < 1 || raw.transitions.length > 25) return null;
  if (raw.states.some((state) => typeof state !== 'string' || !validStates.has(state as ChangeWorkflowStatus)) || new Set(raw.states).size !== raw.states.length) return null;
  const states = raw.states as ChangeWorkflowStatus[];
  const transitions: WorkflowTransitionDefinition[] = [];
  for (const item of raw.transitions) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const transition = item as Record<string, unknown>;
    if (typeof transition.from !== 'string' || typeof transition.to !== 'string' || !states.includes(transition.from as ChangeWorkflowStatus) || !states.includes(transition.to as ChangeWorkflowStatus) || transition.from === transition.to) return null;
    if (!Array.isArray(transition.allowedProjectRoles) || transition.allowedProjectRoles.length < 1 || transition.allowedProjectRoles.some((role) => typeof role !== 'string' || !validRoles.has(role as ProjectRole)) || new Set(transition.allowedProjectRoles).size !== transition.allowedProjectRoles.length) return null;
    const selfApprovalForbidden = transition.selfApprovalForbidden === undefined ? transition.to === 'CONFIRMED' : transition.selfApprovalForbidden;
    if (typeof selfApprovalForbidden !== 'boolean') return null;
    let condition: WorkflowCondition | undefined;
    if (transition.condition !== undefined) {
      const rawCondition = transition.condition;
      if (!rawCondition || typeof rawCondition !== 'object' || Array.isArray(rawCondition)) return null;
      const c = rawCondition as Record<string, unknown>;
      if (c.field !== 'submittedAmount' || !['LTE', 'GT'].includes(String(c.op)) || typeof c.value !== 'string' || !/^\d{1,12}(?:\.\d{1,2})?$/.test(c.value)) return null;
      condition = { field: 'submittedAmount', op: c.op as 'LTE' | 'GT', value: c.value };
    }
    transitions.push({ from: transition.from as ChangeWorkflowStatus, to: transition.to as ChangeWorkflowStatus, allowedProjectRoles: transition.allowedProjectRoles as ProjectRole[], selfApprovalForbidden, ...(condition ? { condition } : {}) });
  }
  const pairs = transitions.map((item) => `${item.from}->${item.to}:${item.condition ? `${item.condition.op}-${item.condition.value}` : 'any'}`);
  if (new Set(pairs).size !== pairs.length) return null;
  return { states, transitions };
}

export function workflowTransitionAllowed(input: {
  definition: WorkflowDefinition; from: string; to: string; role: ProjectRole; submittedAmount: unknown;
}): { allowed: boolean; selfApprovalForbidden: boolean; reason: 'NO_TRANSITION' | 'ROLE_NOT_ALLOWED' | 'CONDITION_NOT_MET' | null } {
  const candidates = input.definition.transitions.filter((item) => item.from === input.from && item.to === input.to);
  if (!candidates.length) return { allowed: false, selfApprovalForbidden: input.to === 'CONFIRMED', reason: 'NO_TRANSITION' };
  for (const transition of candidates) {
    if (transition.condition) {
      let amount: bigint;
      let threshold: bigint;
      try { amount = moneyToCents(input.submittedAmount); threshold = moneyToCents(transition.condition.value); }
      catch { continue; }
      const conditionMatches = transition.condition.op === 'LTE' ? amount <= threshold : amount > threshold;
      if (!conditionMatches) continue;
    }
    if (!transition.allowedProjectRoles.includes(input.role)) continue;
    return { allowed: true, selfApprovalForbidden: transition.selfApprovalForbidden, reason: null };
  }
  let anyConditionMatched = false;
  for (const transition of candidates) {
    let conditionMatches = true;
    if (transition.condition) {
      try {
        const amount = moneyToCents(input.submittedAmount);
        const threshold = moneyToCents(transition.condition.value);
        conditionMatches = transition.condition.op === 'LTE' ? amount <= threshold : amount > threshold;
      } catch { conditionMatches = false; }
    }
    if (conditionMatches) {
      anyConditionMatched = true;
      if (transition.allowedProjectRoles.includes(input.role)) {
        return { allowed: true, selfApprovalForbidden: transition.selfApprovalForbidden, reason: null };
      }
    }
  }
  return {
    allowed: false,
    selfApprovalForbidden: candidates.some((item) => item.selfApprovalForbidden),
    reason: anyConditionMatched ? 'ROLE_NOT_ALLOWED' : candidates.some((item) => item.condition) ? 'CONDITION_NOT_MET' : 'ROLE_NOT_ALLOWED',
  };
}

export const DEFAULT_CHANGE_WORKFLOW: WorkflowDefinition = {
  states: ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CONFIRMED', 'REJECTED'],
  transitions: [
    { from: 'DRAFT', to: 'SUBMITTED', allowedProjectRoles: ['OWNER', 'MANAGER', 'ESTIMATOR'], selfApprovalForbidden: false },
    { from: 'SUBMITTED', to: 'UNDER_REVIEW', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'SUBMITTED', to: 'REJECTED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'UNDER_REVIEW', to: 'CONFIRMED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: true },
    { from: 'UNDER_REVIEW', to: 'REJECTED', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
    { from: 'REJECTED', to: 'DRAFT', allowedProjectRoles: ['OWNER', 'MANAGER'], selfApprovalForbidden: false },
  ],
};
