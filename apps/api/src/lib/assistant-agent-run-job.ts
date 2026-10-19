import { prisma } from './prisma.js';
import { buildAssistantHistoryWithinBudget } from './assistant-context-budget.js';
import { isAssistantBaseUrlValid } from './assistant-config.js';
import { canAccessProject } from './project-access.js';
import { appendAssistantRunEvent, type AssistantEventJsonValue } from './assistant-run-events.js';
import { PermanentBackgroundJobError } from './background-jobs.js';
import type { BackgroundJobHandler } from './background-job-types.js';
import type { AuthUser } from './auth.js';
import type { LangGraphAssistantTurn } from '../assistant/runtime/langgraph-adapter.js';

const MAX_CONTEXT_MESSAGES = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readPayload(payload: unknown): { conversationId: string; runId: string; requestId: string } {
  if (!isRecord(payload) || typeof payload.conversationId !== 'string' || typeof payload.runId !== 'string' || typeof payload.requestId !== 'string') {
    throw new PermanentBackgroundJobError('ASSISTANT_JOB_PAYLOAD_INVALID');
  }
  if ([payload.conversationId, payload.runId].some((value) => value.length < 1 || value.length > 100)
    || payload.requestId.length < 8 || payload.requestId.length > 100) {
    throw new PermanentBackgroundJobError('ASSISTANT_JOB_PAYLOAD_INVALID');
  }
  return { conversationId: payload.conversationId, runId: payload.runId, requestId: payload.requestId };
}

async function isCancellationRequested(runId: string): Promise<boolean> {
  const run = await prisma.assistantRun.findUnique({ where: { id: runId }, select: { status: true, cancelRequestedAt: true } });
  return !run || run.status === 'CANCELLED' || run.cancelRequestedAt !== null;
}

async function appendEvent(conversationId: string, runId: string, type: string, payload: Record<string, AssistantEventJsonValue>) {
  await prisma.$transaction((tx) => appendAssistantRunEvent(tx, { conversationId, runId, type, payload }));
}

async function finishCancelled(conversationId: string, runId: string) {
  await prisma.$transaction(async (tx) => {
    const changed = await tx.assistantRun.updateMany({
      where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date(), errorCode: null },
    });
    if (changed.count === 1) {
      await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.cancelled', payload: { runId } });
    }
  });
}

async function failRun(conversationId: string, runId: string, code: string) {
  await prisma.$transaction(async (tx) => {
    // Cancellation wins if it was committed before this terminal transition.
    const current = await tx.assistantRun.findUnique({ where: { id: runId }, select: { status: true, cancelRequestedAt: true, ownerUserId: true, projectId: true } });
    if (!current || ['COMPLETED', 'FAILED', 'CANCELLED'].includes(current.status)) return;
    const now = new Date();
    if (current.cancelRequestedAt) {
      const cancelled = await tx.assistantRun.updateMany({
        where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] }, cancelRequestedAt: { not: null } },
        data: { status: 'CANCELLED', finishedAt: now, errorCode: null },
      });
      if (cancelled.count === 1) await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.cancelled', payload: { runId } });
      return;
    }
    const failed = await tx.assistantRun.updateMany({
      where: { id: runId, status: { in: ['QUEUED', 'RUNNING'] }, cancelRequestedAt: null },
      data: { status: 'FAILED', errorCode: code, finishedAt: now },
    });
    if (failed.count === 1) {
      await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.failed', payload: { runId, code } });
      await tx.auditLog.create({ data: { projectId: current.projectId, userId: current.ownerUserId, entity: 'AssistantRun', entityId: runId, action: 'ASSISTANT_RUN_FAILED', changes: { code } } });
    }
  });
}

type AssistantTurnRunner = (input: LangGraphAssistantTurn) => Promise<string>;

/** Test-only in-process seam. Production registry uses the default LangGraph adapter with no injected dependencies. */
export function createAssistantAgentRunJobHandler(overrides: { runAssistantTurn?: AssistantTurnRunner } = {}): BackgroundJobHandler {
  return async (job) => {
  if (job.payloadVersion !== 1) throw new PermanentBackgroundJobError('ASSISTANT_JOB_PAYLOAD_VERSION_UNSUPPORTED');
  if (!job.projectId) throw new PermanentBackgroundJobError('ASSISTANT_JOB_PROJECT_REQUIRED');
  const { conversationId, runId, requestId } = readPayload(job.payload);
  const run = await prisma.assistantRun.findFirst({
    where: { id: runId, conversationId, ownerUserId: job.ownerUserId, projectId: job.projectId },
    include: { conversation: true },
  });
  if (!run) throw new PermanentBackgroundJobError('ASSISTANT_RUN_NOT_FOUND');
  if (run.status === 'CANCELLED' || run.cancelRequestedAt || run.status === 'COMPLETED') return;
  if (run.status !== 'QUEUED') throw new PermanentBackgroundJobError('ASSISTANT_RUN_STATE_INVALID');

  if (process.env.ASSISTANT_POC_ENABLED !== 'true') {
    await failRun(conversationId, runId, 'ASSISTANT_DISABLED');
    throw new PermanentBackgroundJobError('ASSISTANT_DISABLED');
  }
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelId = process.env.ASSISTANT_POC_MODEL_ID?.trim();
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const checkpointUrl = process.env.ASSISTANT_CHECKPOINT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!apiKey || !modelId || !checkpointUrl || !isAssistantBaseUrlValid(baseURL)) {
    await failRun(conversationId, runId, 'ASSISTANT_RUNTIME_NOT_CONFIGURED');
    throw new PermanentBackgroundJobError('ASSISTANT_RUNTIME_NOT_CONFIGURED');
  }

  const [user, promptMessage, historyDesc] = await Promise.all([
    prisma.user.findUnique({ where: { id: job.ownerUserId }, select: { id: true, email: true, role: true, isActive: true } }),
    prisma.assistantMessage.findFirst({ where: { conversationId, requestId, role: 'USER' }, select: { id: true, content: true, createdAt: true } }),
    prisma.assistantMessage.findMany({ where: { conversationId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: MAX_CONTEXT_MESSAGES + 1, select: { role: true, content: true, createdAt: true, id: true } }),
  ]);
  if (!user?.isActive || !promptMessage) {
    await failRun(conversationId, runId, 'ASSISTANT_ACTOR_OR_PROMPT_MISSING');
    throw new PermanentBackgroundJobError('ASSISTANT_ACTOR_OR_PROMPT_MISSING');
  }
  if (!(await canAccessProject(user.id, user.role, run.projectId, undefined, 'PROJECT_READ'))) {
    await failRun(conversationId, runId, 'PROJECT_ACCESS_DENIED');
    throw new PermanentBackgroundJobError('PROJECT_ACCESS_DENIED');
  }
  if (await isCancellationRequested(runId)) {
    await finishCancelled(conversationId, runId);
    return;
  }

  await prisma.$transaction(async (tx) => {
    const changed = await tx.assistantRun.updateMany({ where: { id: runId, status: 'QUEUED', cancelRequestedAt: null }, data: { status: 'RUNNING', startedAt: new Date() } });
    if (changed.count !== 1) throw new PermanentBackgroundJobError('ASSISTANT_RUN_CLAIM_LOST');
    await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.started', payload: { runId } });
  });

  const priorMessages = historyDesc
    .filter((message) => message.id !== promptMessage.id && message.createdAt <= promptMessage.createdAt)
    .slice(0, MAX_CONTEXT_MESSAGES - 1)
    .reverse()
    .map((message) => ({ role: message.role === 'USER' ? 'user' as const : 'assistant' as const, content: message.content }));
  const boundedHistory = buildAssistantHistoryWithinBudget(priorMessages, promptMessage.content);
  const history = boundedHistory.messages;
  const contextTruncated = boundedHistory.truncated || historyDesc.length > MAX_CONTEXT_MESSAGES;
  const actor: AuthUser = { sub: user.id, email: user.email, role: user.role, sid: 'assistant-background-job' };
  const cancellationController = new AbortController();
  let cancellationPollStopped = false;
  let cancellationPollTimer: ReturnType<typeof setTimeout> | undefined;
  const pollForCancellation = () => {
    cancellationPollTimer = setTimeout(async () => {
      try {
        if (await isCancellationRequested(runId)) {
          cancellationController.abort(new Error('ASSISTANT_CANCEL_REQUESTED'));
          return;
        }
      } catch {
        // A transient database probe failure must not be treated as a user cancellation.
      }
      if (!cancellationPollStopped && !cancellationController.signal.aborted) pollForCancellation();
    }, 1500);
    cancellationPollTimer.unref?.();
  };
  pollForCancellation();

  try {
    // Loading provider/runtime packages only at execution time keeps ordinary API startup independent of Agent code paths.
    const runtime = await import('../assistant/runtime/langgraph-adapter.js');
    const runAssistantTurn = overrides.runAssistantTurn ?? runtime.runLangGraphAssistantTurn;
    const responseText = await runAssistantTurn({
      apiKey, modelId, baseURL, checkpointUrl, conversationId, runId, projectId: run.projectId,
      actor, messages: history, contextTruncated,
      signal: cancellationController.signal,
      isCancellationRequested: () => isCancellationRequested(runId),
      emit: (type, payload) => appendEvent(conversationId, runId, type, payload),
    });
    if (await isCancellationRequested(runId)) {
      await finishCancelled(conversationId, runId);
      return;
    }

    await prisma.$transaction(async (tx) => {
      // Atomically claim the terminal transition before writing an answer. The cancel endpoint
      // sets cancelRequestedAt under the same row lock; a late cancel must never lose to an
      // unconditional `status = COMPLETED` update.
      const completed = await tx.assistantRun.updateMany({
        where: { id: runId, status: 'RUNNING', cancelRequestedAt: null },
        data: { status: 'COMPLETED', finishedAt: new Date(), errorCode: null },
      });
      if (completed.count !== 1) {
        const current = await tx.assistantRun.findUnique({ where: { id: runId }, select: { status: true, cancelRequestedAt: true } });
        if (current?.status === 'RUNNING' && current.cancelRequestedAt) {
          const cancelled = await tx.assistantRun.updateMany({
            where: { id: runId, status: 'RUNNING', cancelRequestedAt: { not: null } },
            data: { status: 'CANCELLED', finishedAt: new Date(), errorCode: null },
          });
          if (cancelled.count === 1) await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.cancelled', payload: { runId } });
        }
        return;
      }
      const answer = await tx.assistantMessage.create({ data: { conversationId, role: 'ASSISTANT', content: responseText, status: 'COMPLETED' } });
      await tx.assistantConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } });
      await appendAssistantRunEvent(tx, { conversationId, runId, type: 'run.completed', payload: { runId, messageId: answer.id } });
      await tx.auditLog.create({ data: {
        projectId: run.projectId, userId: user.id, entity: 'AssistantRun', entityId: runId,
        action: 'ASSISTANT_RUN_COMPLETED', changes: { conversationId, modelId },
      } });
    });
  } catch {
    if (await isCancellationRequested(runId).catch(() => false)) {
      await finishCancelled(conversationId, runId);
      return;
    }
    await failRun(conversationId, runId, 'ASSISTANT_RUNTIME_FAILED').catch(() => undefined);
    throw new PermanentBackgroundJobError('ASSISTANT_RUNTIME_FAILED');
  } finally {
    cancellationPollStopped = true;
    if (cancellationPollTimer) clearTimeout(cancellationPollTimer);
  }
  };
}

export const assistantAgentRunJobHandler: BackgroundJobHandler = createAssistantAgentRunJobHandler();
