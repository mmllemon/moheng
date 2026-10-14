import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import { calculateEffectiveContractAmount } from './contract-amount-math.js';

/**
 * Rebuilds the project total from the immutable original amount plus effective
 * external confirmations only. The project row is locked to serialize concurrent
 * confirmation transactions and avoid losing one of two simultaneous updates.
 */
export async function recalculateEffectiveContractAmount(
  tx: PrismaTypes.TransactionClient,
  projectId: string,
): Promise<string> {
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Project" WHERE "id" = ${projectId} FOR UPDATE`);
  const project = await tx.project.findFirst({ where: { id: projectId, deletedAt: null }, select: { originalContractAmount: true } });
  if (!project) throw new Error('PROJECT_NOT_FOUND');
  const adjustments = await tx.change.findMany({
    where: { projectId, deletedAt: null, externalConfirmationStatus: 'EFFECTIVE', externalConfirmedAmount: { not: null } },
    select: { direction: true, externalConfirmedAmount: true },
  });
  const total = calculateEffectiveContractAmount(project.originalContractAmount, adjustments.map((item) => ({
    direction: item.direction,
    amount: item.externalConfirmedAmount,
  })));
  await tx.project.update({ where: { id: projectId }, data: { contractAmount: total } });
  return total;
}
