import { ApiError } from '../api';

export type ErrorPresentation = {
  /** 一句话定性：这是哪一类错误 */
  title: string;
  /** 下一步该怎么办 */
  hint: string;
  /** 便于排障的错误码（有就显示） */
  code?: string;
};

const NETWORK_HINTS = ['Failed to fetch', 'NetworkError', 'Load failed', 'fetch failed', 'Network request failed'];

/**
 * 把各种错误折成「定性 + 下一步 + 错误码」。
 *
 * 背景：全站只有一个 `ErrorBlock`，标题恒为「数据暂时不可用」。
 * 2026-10-29 库少一条迁移时，所有项目接口 500，页面只显示这一句，
 * 既看不出是服务端、权限还是网络，也不知道该找谁。这里把差别说出来。
 */
export function describeError(error?: unknown, fallbackMessage?: string): ErrorPresentation {
  if (error instanceof ApiError) {
    const code = error.code;
    if (error.status === 401) {
      return { title: '登录状态已失效', hint: '请重新登录后再试。', code };
    }
    if (error.status === 403) {
      return { title: '没有访问权限', hint: '当前账号或项目范围不含这项数据；需要查看请联系管理员调整授权。', code };
    }
    if (error.status === 404) {
      return { title: '内容不存在', hint: '它可能已被删除，或链接已经过期。', code };
    }
    if (error.status === 429) {
      return { title: '请求过于频繁', hint: '稍等片刻再重试。', code };
    }
    if (error.status >= 500) {
      return {
        title: '服务端出错了',
        hint: '这次请求没有完成。稍后重试；若持续出现，检查 API 日志，或确认数据库迁移是否已应用（数据库结构未同步会显示在主内容区底部）。',
        code,
      };
    }
    return { title: '请求没有完成', hint: error.message || fallbackMessage || '请稍后重试。', code };
  }

  const message = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : '';

  if (message && NETWORK_HINTS.some((hint) => message.includes(hint))) {
    return { title: '网络连接失败', hint: '前端连不上 API：确认后端已启动、端口正确，然后重试。' };
  }
  if (message) return { title: '数据暂时不可用', hint: message };
  return { title: '数据暂时不可用', hint: fallbackMessage ?? '请稍后重试。' };
}
