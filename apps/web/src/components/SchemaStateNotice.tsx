import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

type MetaPayload = {
  schemaState?: {
    reachable: boolean;
    total: number | null;
    applied: number | null;
    pending: string[];
    latest: string | null;
    error?: string;
  };
};

const DISMISS_KEY = 'moheng.schema-notice-dismissed';

/**
 * 库落后 / 连不上库时的常驻提示条。
 *
 * 背景：2026-10-29 运行库少一条迁移（Project.workspaceRoot），代码里 35 处引用该字段，
 * 所有项目查询 500，而前端只能显示「数据暂时不可用」，原因完全不可见。
 * 现在 /api/meta 会下发 schemaState，这里把「落后几条、缺哪条」直接说出来。
 *
 * 位置：贴主内容区底部。它是一条系统状态，不该占用页面顶部（那里是页面自己的层级），
 * 也不该随内容滚走。可以手动隐藏，但重新加载后会再出现。
 */
export default function SchemaStateNotice() {
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { return false; }
  });
  const metaQuery = useQuery({
    queryKey: ['api-meta'],
    queryFn: () => api.get<MetaPayload>('/meta'),
    staleTime: 60_000,
    retry: false,
    enabled: !dismissed,
  });

  if (dismissed) return null;
  const state = metaQuery.data?.schemaState;
  if (!state) return null;

  const unreachable = !state.reachable;
  const behind = state.pending.length > 0;
  if (!unreachable && !behind) return null;

  const detail = unreachable
    ? `无法读取数据库迁移状态：${state.error ?? '未知原因'}。数据相关页面可能不可用。`
    : `数据库落后 ${state.pending.length} 条迁移（已应用 ${state.applied} / ${state.total}）。请先执行 npm run db:deploy -w @cms/api，再重启 API。缺席：${state.pending.join('、')}`;

  return <div className={`schema-state-notice${unreachable ? ' is-unreachable' : ''}`} role="status">
    <span className="schema-state-notice-mark" aria-hidden="true" />
    <p><strong>{unreachable ? '数据库连接异常' : '数据库结构未同步'}</strong><span>{detail}</span></p>
    <button type="button" className="schema-state-notice-close" onClick={() => {
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* 存储不可用时只隐藏本次 */ }
      setDismissed(true);
    }}>隐藏</button>
  </div>;
}
