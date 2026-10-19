import type { Prisma } from '../generated/prisma/client.js';

export const MAX_ACTIVE_ASSISTANT_RUNS_PER_USER = 2;

export function isAssistantUserRunLimitReached(activeRunCount: number): boolean {
  if (!Number.isSafeInteger(activeRunCount) || activeRunCount < 0) {
    throw new Error('ASSISTANT_ACTIVE_RUN_COUNT_INVALID');
  }
  return activeRunCount >= MAX_ACTIVE_ASSISTANT_RUNS_PER_USER;
}

/**
 * Serialize run admission per user inside the caller's transaction.
 * The user-row lock must stay held through creation of the accepted AssistantRun,
 * so concurrent submissions in different conversations cannot both pass the count.
 */
export async function assertAssistantUserRunCapacity(
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
}
