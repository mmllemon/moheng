import { api, ApiError } from './api';
import { parseAssistantSseBlock } from './assistant-sse-parser.mjs';
import { useAuthStore } from './auth-store';

const ROOT = '/assistant-poc';

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
export type AssistantStatus = {
  enabled: boolean;
  configurationReady: boolean;
  configuration: {
    providerConfigured: boolean;
    modelConfigured: boolean;
    checkpointConfigured: boolean;
    endpointValid: boolean;
  };
};
export type AssistantConversationSummary = {
  id: string;
  projectId: string;
  title: string;
  status: 'ACTIVE' | 'ARCHIVED';
  lastMessageAt: string;
  createdAt: string;
  messageCount?: number;
};
export type AssistantMessage = {
  id: string;
  conversationId: string;
  requestId: string | null;
  role: 'USER' | 'ASSISTANT';
  content: string;
  status: string;
  createdAt: string;
};
export type AssistantRunSummary = {
  id: string;
  requestId: string;
  status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | string;
  errorCode: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  lastEventSequence: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  usageStatus: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE' | string;
  usageCapturedAt: string | null;
};
export type AssistantConversationDetail = AssistantConversationSummary & {
  ownerUserId: string;
  updatedAt: string;
  messages: AssistantMessage[];
  runs: AssistantRunSummary[];
};
export type AssistantRunSubmission = {
  runId: string;
  status: string;
  idempotentReplay: boolean;
  eventsUrl: string;
};
export type AssistantSource = {
  entity: string;
  fields: string[];
  rowCount: number;
  scope: string;
};
export type AssistantRunEvent = {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export async function getAssistantStatus() {
  return api.get<AssistantStatus>(`${ROOT}/status`);
}

export async function getAssistantUsageSummary(projectId: string) {
  const query = new URLSearchParams({ projectId });
  return api.get<AssistantUsageSummary>(`${ROOT}/usage-summary?${query.toString()}`);
}

export async function listAssistantConversations(projectId: string, includeArchived = false) {
  const query = new URLSearchParams({ projectId, ...(includeArchived ? { includeArchived: 'true' } : {}) });
  return api.get<AssistantConversationSummary[]>(`${ROOT}/conversations?${query.toString()}`);
}

export async function createAssistantConversation(projectId: string) {
  return api.post<Pick<AssistantConversationSummary, 'id' | 'projectId' | 'title' | 'status' | 'createdAt'>>(`${ROOT}/conversations`, { projectId, title: '新建成本分析' });
}

export async function getAssistantConversation(conversationId: string) {
  return api.get<AssistantConversationDetail>(`${ROOT}/conversations/${encodeURIComponent(conversationId)}`);
}

export async function submitAssistantMessage(conversationId: string, content: string, requestId = createRequestId()) {
  return api.post<AssistantRunSubmission>(`${ROOT}/conversations/${encodeURIComponent(conversationId)}/messages`, { requestId, content });
}

export async function archiveAssistantConversation(conversationId: string) {
  return api.post<{ id: string; status: string; alreadyArchived?: boolean }>(`${ROOT}/conversations/${encodeURIComponent(conversationId)}/archive`);
}

export async function cancelAssistantRun(conversationId: string, runId: string) {
  return api.post<{ id: string; status: string; alreadyTerminal: boolean; cancelAlreadyRequested: boolean }>(`${ROOT}/conversations/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/cancel`);
}

export function createRequestId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2, 14)}`;
}

function isTerminalEvent(type: string) {
  return type === 'run.completed' || type === 'run.failed' || type === 'run.cancelled' || type === 'access.revoked';
}

function waitRetry(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const timer = window.setTimeout(done, milliseconds);
    function done() { signal.removeEventListener('abort', abort); resolve(); }
    function abort() { window.clearTimeout(timer); signal.removeEventListener('abort', abort); reject(new DOMException('Aborted', 'AbortError')); }
    signal.addEventListener('abort', abort, { once: true });
  });
}


async function authorizedStreamFetch(url: string, cursor: number, signal: AbortSignal) {
  const send = () => {
    const headers = new Headers({ Accept: 'text/event-stream', 'Last-Event-ID': String(cursor) });
    const token = useAuthStore.getState().accessToken;
    if (token) headers.set('Authorization', `Bearer ${token}`);
    return fetch(url, { method: 'GET', headers, credentials: 'include', cache: 'no-store', signal });
  };
  let response = await send();
  if (response.status === 401 && await api.refreshSession()) response = await send();
  if (!response.ok) {
    let message = `事件流请求失败（${response.status}）`;
    let code = 'ASSISTANT_EVENT_STREAM_FAILED';
    try {
      const body = await response.json() as { success?: boolean; error?: { message?: string; code?: string } };
      message = body.error?.message ?? message;
      code = body.error?.code ?? code;
    } catch { /* HTTP response may be an intermediary error page. */ }
    throw new ApiError(message, code, response.status);
  }
  return response;
}

/** Reads the durable SSE log with Last-Event-ID resume and bounded reconnect backoff. */
export async function watchAssistantRun(
  eventsUrl: string,
  signal: AbortSignal,
  onEvent: (event: AssistantRunEvent) => void,
  initialCursor = 0,
) {
  const url = eventsUrl.startsWith('/api/') ? eventsUrl : `/api${eventsUrl}`;
  let cursor = initialCursor;
  let retry = 600;
  while (!signal.aborted) {
    const response = await authorizedStreamFetch(url, cursor, signal);
    const reader = response.body?.getReader();
    if (!reader) throw new ApiError('浏览器未提供 SSE 响应流', 'ASSISTANT_STREAM_UNSUPPORTED', response.status);
    let buffer = '';
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value, { stream: true });
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const event = parseAssistantSseBlock(block);
          if (!event) continue;
          if (event.sequence > 0) {
            if (event.sequence <= cursor) continue;
            cursor = event.sequence;
          } else if (event.type !== 'access.revoked' && event.type !== 'stream.error') {
            continue;
          }
          onEvent(event);
          retry = 600;
          if (isTerminalEvent(event.type)) return { cursor, terminalEvent: event };
          if (event.type === 'stream.error') throw new ApiError('助手事件流异常中断', 'ASSISTANT_EVENT_STREAM_FAILED', 502, event.payload);
        }
      }
    } finally {
      try { await reader.cancel(); } catch { /* A completed or aborted stream may already be closed. */ }
      reader.releaseLock();
    }
    if (signal.aborted) break;
    await waitRetry(retry, signal);
    retry = Math.min(4000, Math.round(retry * 1.7));
  }
  return { cursor, terminalEvent: null };
}
