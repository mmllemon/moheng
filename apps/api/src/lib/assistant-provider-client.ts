import { isAssistantBaseUrlValid } from './assistant-config.js';

export class AssistantProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 502) {
    super(message);
    this.name = 'AssistantProviderError';
  }
}

export function normalizeProviderBaseUrl(raw: string): string {
  const value = raw.trim();
  if (!value) throw new AssistantProviderError('ASSISTANT_PROVIDER_URL_REQUIRED', '请填写 OpenAI 兼容接口地址', 400);
  if (!isAssistantBaseUrlValid(value)) throw new AssistantProviderError('ASSISTANT_PROVIDER_URL_INVALID', '接口地址必须是合法的 HTTP(S) 绝对地址，不能包含账号、查询参数或锚点', 400);
  const url = new URL(value);
  if (url.hostname === '169.254.169.254' || url.hostname.toLowerCase() === 'metadata.google.internal') {
    throw new AssistantProviderError('ASSISTANT_PROVIDER_URL_FORBIDDEN', '不允许访问云元数据地址', 400);
  }
  return value.replace(/\/+$/, '');
}

type ProviderModel = { id: string; ownedBy: string | null };

function parseModels(payload: unknown): ProviderModel[] {
  const rows = Array.isArray(payload) ? payload : (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data) ? (payload as { data: unknown[] }).data : []);
  const seen = new Set<string>();
  const models: ProviderModel[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = row as { id?: unknown; owned_by?: unknown };
    if (typeof value.id !== 'string' || !value.id.trim()) continue;
    const id = value.id.trim();
    if (seen.has(id)) continue;
    seen.add(id);
    models.push({ id, ownedBy: typeof value.owned_by === 'string' ? value.owned_by : null });
  }
  return models.sort((a, b) => a.id.localeCompare(b.id));
}

/** Server-side provider call; the API key never leaves the server and is never echoed. */
export async function fetchAssistantProviderModels(input: { baseUrl: string; apiKey: string; timeoutMs?: number }): Promise<{ models: ProviderModel[]; latencyMs: number }> {
  const baseUrl = normalizeProviderBaseUrl(input.baseUrl);
  if (!input.apiKey.trim()) throw new AssistantProviderError('ASSISTANT_PROVIDER_KEY_MISSING', '请先填写模型服务密钥', 400);
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(baseUrl + '/models', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + input.apiKey.trim(), Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(input.timeoutMs ?? 12_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AssistantProviderError('ASSISTANT_PROVIDER_TIMEOUT', '模型服务在 12 秒内没有响应', 504);
    }
    throw new AssistantProviderError('ASSISTANT_PROVIDER_UNREACHABLE', '无法访问模型服务，请检查地址、网络与 TLS', 502);
  }
  const text = await response.text().catch(() => '');
  if (!response.ok) throw new AssistantProviderError('ASSISTANT_PROVIDER_MODELS_FAILED', '模型服务返回 HTTP ' + response.status, 502);
  if (text.length > 2 * 1024 * 1024) throw new AssistantProviderError('ASSISTANT_PROVIDER_RESPONSE_TOO_LARGE', '模型列表响应超过 2 MB', 502);
  let payload: unknown;
  try { payload = JSON.parse(text); } catch { throw new AssistantProviderError('ASSISTANT_PROVIDER_RESPONSE_INVALID', '模型服务返回的不是合法 JSON', 502); }
  const models = parseModels(payload);
  if (!models.length) throw new AssistantProviderError('ASSISTANT_PROVIDER_MODELS_EMPTY', '供应商没有返回可用模型', 502);
  return { models, latencyMs: Date.now() - started };
}
