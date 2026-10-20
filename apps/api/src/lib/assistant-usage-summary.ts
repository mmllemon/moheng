export const ASSISTANT_USAGE_SUMMARY_WINDOW_DAYS = 30;

export type AssistantUsageGroup = {
  usageStatus: string;
  _count: { _all: number };
  _sum: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

export type AssistantUsageSummary = {
  projectId: string;
  periodStart: string;
  periodEnd: string;
  windowDays: number;
  terminalRuns: number;
  completeRuns: number;
  partialRuns: number;
  unavailableRuns: number;
  activeRuns: number;
  tokens: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  } | null;
};

/**
 * Build a project/owner-scoped summary from database aggregates.
 * Incomplete or unavailable provider usage is deliberately excluded from token totals.
 */
export function buildAssistantUsageSummary(input: {
  projectId: string;
  periodStart: Date;
  periodEnd: Date;
  activeRuns: number;
  groups: AssistantUsageGroup[];
}): AssistantUsageSummary {
  const countFor = (usageStatus: string) =>
    input.groups.find((group) => group.usageStatus === usageStatus)?._count._all ?? 0;

  const completeRuns = countFor('COMPLETE');
  const partialRuns = countFor('PARTIAL');
  const unavailableRuns = countFor('UNAVAILABLE');
  const terminalRuns = input.groups.reduce((sum, group) => sum + group._count._all, 0);

  let tokens: AssistantUsageSummary['tokens'] = null;
  if (completeRuns > 0) {
    const totals = input.groups.find((group) => group.usageStatus === 'COMPLETE')?._sum;
    const values = [totals?.inputTokens, totals?.outputTokens, totals?.totalTokens];
    const validCounts = values.every((value) =>
      typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
    if (validCounts) {
      const [inputTokens, outputTokens, totalTokens] = values as [number, number, number];
      if (totalTokens === inputTokens + outputTokens) {
        tokens = { inputTokens, outputTokens, totalTokens };
      }
    }
  }

  return {
    projectId: input.projectId,
    periodStart: input.periodStart.toISOString(),
    periodEnd: input.periodEnd.toISOString(),
    windowDays: ASSISTANT_USAGE_SUMMARY_WINDOW_DAYS,
    terminalRuns,
    completeRuns,
    partialRuns,
    unavailableRuns,
    activeRuns: input.activeRuns,
    tokens,
  };
}
