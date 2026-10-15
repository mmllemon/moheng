import type { Prisma } from '@prisma/client';

export type ClaimedBackgroundJob = {
  id: string;
  type: string;
  status: string;
  payloadVersion: number;
  payload: Prisma.JsonValue;
  resultMetadata: Prisma.JsonValue | null;
  resultFileName: string | null;
  ownerUserId: string;
  projectId: string | null;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
};

export type BackgroundJobHandlerResult = {
  resultFileName?: string;
  resultMetadata?: Prisma.InputJsonValue;
};

export type BackgroundJobHandler = (job: ClaimedBackgroundJob) => Promise<BackgroundJobHandlerResult | void>;
