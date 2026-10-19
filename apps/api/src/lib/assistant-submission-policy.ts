import type { Prisma } from '../generated/prisma/client.js';

export const MAX_ACTIVE_ASSISTANT_RUNS_PER_USER = 2;
export const MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE = 6;

export function isAssistantUserRunLimitReached(activeRunCount: number): boolean {
  if (!Number.isSafeInteger(activeRunCount) || activeRunCount < 0) {
    throw new Error('ASSISTANT_ACTIVE_RUN_COUNT_INVALID');
  }
  return activeRunCount >= MAX_ACTIVE_ASSISTANT_RUNS_PER_USER;
}

export function isAssistantUserSubmissionRateLimitReached(recentSubmissionCount: number): boolean {
  if (!Number.isSafeInteger(recentSubmissionCount) || recentSubmissionCount < 0) {
    throw new Error('ASSISTANT_RECENT_SUBMISSION_COUNT_INVALID');
  }
  return recentSubmissionCount >= MAX_ASSISTANT_SUBMISSIONS_PER_USER_PER_MINUTE;
}

/**
 * Serialize user-level admission inside the caller's transaction.
 * The user-row lock stays held through creation of the accepted AssistantRun,
 * preventing concurrent conversations from racing both the active-run and sliding-window counts.
 */
export async function assertAssistantUserRunAdmission(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  const lockedUsers = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
  if (lockedUsers.length !== 1) throw new Error('ASSISTANT_USER_NOT_FOUND');

  const activeRunCount = await tx.assistantRun.count({
    where: { ownerUserId: userId, status: { in: ['QUEUED', 'RUNNING'] } },
  });
  if (isAssistantUserRunLimitReached(activeRunCount)) {
    throw new Error('ASSISTANT_USER_RUN_LIMIT_REACHED');
  }

  // Count all recent submissions, including completed, failed, or cancelled runs,
  // so quickly ending tasks cannot be used to evade the model-call rate limit.
  const windowStart = new Date(Date.now() - 60_000);
  const recentSubmissionCount = await tx.assistantRun.count({
    where: { ownerUserId: userId, createdAt: { gte: windowStart } },
  });
  if (isAssistantUserSubmissionRateLimitReached(recentSubmissionCount)) {
    throw new Error('ASSISTANT_USER_RUN_RATE_LIMIT_REACHED');
  }
}
