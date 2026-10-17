import { useAuthStore } from './auth-store';

type Envelope<T> = { success: true; data: T; meta?: { total: number; page: number; pageSize: number } };
type ErrorEnvelope = { success: false; error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message); this.name = 'ApiError'; this.code = code; this.status = status; this.details = details;
  }
}

async function decode<T>(response: Response): Promise<T> {
  let body: Envelope<T> | ErrorEnvelope;
  try { body = await response.json() as Envelope<T> | ErrorEnvelope; }
  catch { throw new ApiError('服务器返回了无法识别的数据', 'INVALID_RESPONSE', response.status); }
  if (!response.ok || body.success === false) {
    const err = body.success === false ? body.error : { code: 'HTTP_ERROR', message: response.statusText || '请求失败' };
    throw new ApiError(err.message, err.code, response.status, 'details' in err ? err.details : undefined);
  }
  return body.data;
}

let refreshInFlight: Promise<boolean> | null = null;
async function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
        const body = await response.json() as Envelope<{ accessToken: string; user: import('./types').User }> | ErrorEnvelope;
        if (response.ok && body.success !== false) {
          useAuthStore.getState().setSession(body.data.accessToken, body.data.user);
          return true;
        }
        if (attempt === 0 && body.success === false && body.error.code === 'REFRESH_ROTATION_RACE') {
          // Another tab just rotated the shared HttpOnly cookie. Let its Set-Cookie reach the jar, then retry once.
          await new Promise((resolve) => setTimeout(resolve, 180));
          continue;
        }
        return false;
      } catch {
        return false;
      }
    }
    return false;
  })();
  try { return await refreshInFlight; } finally { refreshInFlight = null; }
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { ...init, headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return request<T>(path, init, false);
    useAuthStore.getState().clearSession();
  }
  return decode<T>(response);
}


async function requestBlob(path: string, retry = true): Promise<Blob> {
  const token = useAuthStore.getState().accessToken;
  const headers = new Headers();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`/api${path}`, { headers, credentials: 'include' });
  if (response.status === 401 && retry && !path.startsWith('/auth/')) {
    const refreshed = await refreshSession();
    if (refreshed) return requestBlob(path, false);
    useAuthStore.getState().clearSession();
  }
  if (!response.ok) {
    let message = response.statusText || '文件下载失败';
    let code = 'HTTP_ERROR';
    try {
      const body = await response.json() as ErrorEnvelope;
      if (body.success === false) { message = body.error.message; code = body.error.code; }
    } catch { /* non-JSON server error */ }
    throw new ApiError(message, code, response.status);
  }
  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown, headers?: HeadersInit) => request<T>(path, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) => request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) => request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  download: (path: string) => requestBlob(path),
  login: (email: string, password: string, totpCode?: string) => request<{ accessToken: string; user: import('./types').User } | { flow: 'mfa-enrollment' | 'password-change'; restrictedToken: string; user: import('./types').User }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password, ...(totpCode ? { totpCode } : {}) }) }, false),
  logout: () => request<{ loggedOut: boolean }>('/auth/logout', { method: 'POST' }, false),
  refreshSession,
};
