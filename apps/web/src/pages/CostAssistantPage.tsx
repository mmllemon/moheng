import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Archive, Check, CircleAlert, Clock3, FileSearch, MessageSquare, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Wrench, X } from 'lucide-react';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Project } from '../types';
import { AssistantThread } from '../components/assistant/AssistantThread';
import {
  archiveAssistantConversation,
  createAssistantConversation,
  getAssistantConversation,
  getAssistantStatus,
  getAssistantUsageSummary,
  listAssistantConversations,
  watchAssistantRun,
  type AssistantConversationDetail,
  type AssistantConversationSummary,
  type AssistantRunEvent,
  type AssistantSource,
} from '../assistant-api';

type WatchEntry = { conversationId: string; controller: AbortController; promise: Promise<void> };
type ToolTrace = { toolId: string; status: 'RUNNING' | 'COMPLETED' | 'FAILED'; sourceCount?: number; durationMs?: number; generatedAt?: string; sources?: AssistantSource[]; limitations?: string[]; code?: string };

const TOOL_LABELS: Record<string, string> = {
  project_operating_overview: '项目经营概览',
  cost_variance: '成本偏差核查',
  change_evidence_completeness: '变更资料完整性检查',
};
const ENTITY_LABELS: Record<string, string> = {
  Project: '项目档案', Change: '变更签证', BudgetItem: '目标成本明细', CostEntry: '实际成本台账', ProgressBill: '业主进度款', DownstreamContractPayment: '分供付款/退款流水', DownstreamContract: '分供合同',
};

export default function CostAssistantPage() {
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null);
  const [configurationReady, setConfigurationReady] = useState<boolean | null>(null);
  const [configurationIssues, setConfigurationIssues] = useState<string[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<AssistantConversationSummary[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AssistantConversationDetail | null>(null);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [loadingList, setLoadingList] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [pageError, setPageError] = useState('');
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [toolTrace, setToolTrace] = useState<ToolTrace[]>([]);
  const [runErrorCode, setRunErrorCode] = useState<string | null>(null);
  const [lastGeneratedAt, setLastGeneratedAt] = useState<string | null>(null);
  const [usageSummary, setUsageSummary] = useState<Awaited<ReturnType<typeof getAssistantUsageSummary>> | null>(null);
  const [usageSummaryError, setUsageSummaryError] = useState(false);
  const [loadingUsageSummary, setLoadingUsageSummary] = useState(false);
  const watchers = useRef(new Map<string, WatchEntry>());
  const selectedConversationRef = useRef<string | null>(null);
  const selectedProjectRef = useRef<string | null>(null);
  selectedConversationRef.current = selectedConversationId;
  selectedProjectRef.current = selectedProjectId;

  const selectedProject = projects.find((project) => project.id === selectedProjectId) ?? null;
  const projectDetail = detail?.projectId === selectedProjectId ? detail : null;
  const visibleConversations = useMemo(() => conversations.filter((conversation) =>
    `${conversation.title} ${conversation.id}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())), [conversations, search]);

  useEffect(() => {
    let alive = true;
    getAssistantStatus().then((status) => {
      if (!alive) return;
      setFeatureEnabled(status.enabled);
      setConfigurationReady(status.configurationReady);
      setConfigurationIssues([
        ...(!status.configuration.providerConfigured ? ['模型服务凭据尚未配置'] : []),
        ...(!status.configuration.modelConfigured ? ['模型 ID 尚未配置'] : []),
        ...(!status.configuration.checkpointConfigured ? ['PostgreSQL 检查点连接尚未配置'] : []),
        ...(status.configuration.endpointValid === false ? ['模型兼容 API 地址格式无效；请配置合法的 HTTP(S) 绝对地址，且不要将密钥写入地址参数'] : []),
      ]);
    }).catch(() => {
      if (!alive) return;
      setFeatureEnabled(false);
      setConfigurationReady(false);
      setConfigurationIssues(['无法读取助手就绪状态，请检查 API 服务后重试。']);
    });
    return () => { alive = false; };
  }, []);

  const refreshConversationList = useCallback(async () => {
    if (!selectedProjectId || featureEnabled !== true) return;
    const list = await listAssistantConversations(selectedProjectId, includeArchived);
    setConversations(list);
    setSelectedConversationId((current) => {
      if (current && list.some((conversation) => conversation.id === current && conversation.projectId === selectedProjectId)) return current;
      return list[0]?.id ?? null;
    });
  }, [featureEnabled, includeArchived, selectedProjectId]);

  const refreshUsageSummary = useCallback(async () => {
    const projectId = selectedProjectId;
    if (!projectId || featureEnabled !== true) {
      setUsageSummary(null);
      setUsageSummaryError(false);
      setLoadingUsageSummary(false);
      return;
    }
    setLoadingUsageSummary(true);
    setUsageSummaryError(false);
    try {
      const summary = await getAssistantUsageSummary(projectId);
      if (selectedProjectRef.current === projectId) setUsageSummary(summary);
    } catch {
      if (selectedProjectRef.current === projectId) {
        setUsageSummary(null);
        setUsageSummaryError(true);
      }
    } finally {
      if (selectedProjectRef.current === projectId) setLoadingUsageSummary(false);
    }
  }, [featureEnabled, selectedProjectId]);

  useEffect(() => {
    void refreshUsageSummary();
  }, [refreshUsageSummary]);

  useEffect(() => {
    let alive = true;
    if (!selectedProjectId || featureEnabled !== true) {
      setConversations([]); setSelectedConversationId(null); setDetail(null); setLoadingList(false);
      return () => { alive = false; };
    }
    setLoadingList(true); setPageError('');
    Promise.all([
      listAssistantConversations(selectedProjectId, includeArchived),
      api.get<Project[]>('/projects'),
    ]).then(([list, projectList]) => {
      if (!alive) return;
      setConversations(list); setProjects(projectList);
      setSelectedConversationId((current) => current && list.some((item) => item.id === current && item.projectId === selectedProjectId) ? current : (list[0]?.id ?? null));
    }).catch((error) => {
      if (!alive) return;
      setPageError(error instanceof ApiError ? error.message : '无法读取助手会话。');
    }).finally(() => { if (alive) setLoadingList(false); });
    return () => { alive = false; };
  }, [featureEnabled, includeArchived, selectedProjectId]);

  const watchRun = useCallback((conversationId: string, runId: string, runProjectId: string) => {
    const existing = watchers.current.get(runId);
    if (existing) return existing.promise;
    const controller = new AbortController();
    setActiveRunId(runId);
    setRunStatus('QUEUED');
    setRunErrorCode(null);
    const promise = (async () => {
      try {
        await watchAssistantRun(`/api/assistant-poc/conversations/${encodeURIComponent(conversationId)}/runs/${encodeURIComponent(runId)}/events`, controller.signal, (event: AssistantRunEvent) => {
          if (selectedConversationRef.current !== conversationId || selectedProjectRef.current !== runProjectId) return;
          setActiveRunId(runId);
          if (event.type === 'run.started') setRunStatus('RUNNING');
          else if (event.type === 'run.queued') setRunStatus('QUEUED');
          else if (event.type === 'run.completed') setRunStatus('COMPLETED');
          else if (event.type === 'run.cancelled') setRunStatus('CANCELLED');
          else if (event.type === 'run.failed') {
            setRunStatus('FAILED');
            setRunErrorCode(typeof event.payload.code === 'string' ? event.payload.code : 'ASSISTANT_RUNTIME_FAILED');
          } else if (event.type === 'run.cancel_requested') setRunStatus('RUNNING');
          if (event.type === 'tool.started' || event.type === 'tool.completed' || event.type === 'tool.failed') {
            const toolId = typeof event.payload.toolId === 'string' ? event.payload.toolId : 'unknown_tool';
            setToolTrace((current) => {
              const next: ToolTrace = {
                toolId,
                status: event.type === 'tool.started' ? 'RUNNING' : event.type === 'tool.completed' ? 'COMPLETED' : 'FAILED',
                sourceCount: typeof event.payload.sourceCount === 'number' ? event.payload.sourceCount : undefined,
                durationMs: typeof event.payload.durationMs === 'number' ? event.payload.durationMs : undefined,
                generatedAt: typeof event.payload.generatedAt === 'string' ? event.payload.generatedAt : undefined,
                sources: Array.isArray(event.payload.sources) ? event.payload.sources.filter((source): source is AssistantSource => Boolean(source && typeof source === 'object' && typeof (source as AssistantSource).entity === 'string')) : undefined,
                limitations: Array.isArray(event.payload.limitations) ? event.payload.limitations.filter((text): text is string => typeof text === 'string') : undefined,
                code: typeof event.payload.code === 'string' ? event.payload.code : undefined,
              };
              return [...current.filter((item) => item.toolId !== toolId), next];
            });
            if (typeof event.payload.generatedAt === 'string') setLastGeneratedAt(event.payload.generatedAt);
          }
          if (event.type === 'access.revoked') { setRunStatus('FAILED'); setRunErrorCode('PROJECT_ACCESS_REVOKED'); }
        }, 0);
      } catch (error) {
        if (!controller.signal.aborted && selectedConversationRef.current === conversationId && selectedProjectRef.current === runProjectId) {
          setRunStatus('FAILED');
          setRunErrorCode(error instanceof ApiError ? error.code : 'ASSISTANT_EVENT_STREAM_FAILED');
        }
      } finally {
        if (!controller.signal.aborted) {
          try {
            const latest = await getAssistantConversation(conversationId);
            if (selectedConversationRef.current === conversationId && selectedProjectRef.current === latest.projectId) {
              setDetail(latest);
              const persistedRun = latest.runs.find((item) => item.id === runId);
              // A durable terminal state is more authoritative than a late SSE transport error.
              if (persistedRun && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(persistedRun.status)) {
                setActiveRunId(runId);
                setRunStatus(persistedRun.status);
                setRunErrorCode(persistedRun.status === 'FAILED' ? (persistedRun.errorCode ?? 'ASSISTANT_RUNTIME_FAILED') : null);
              }
            }
            await refreshConversationList();
          } catch { /* Visible run state remains available; refresh can be retried. */ }
        }
        if (watchers.current.get(runId)?.controller === controller) watchers.current.delete(runId);
      }
    })();
    watchers.current.set(runId, { conversationId, controller, promise });
    return promise;
  }, [refreshConversationList, refreshUsageSummary]);

  useEffect(() => {
    let alive = true;
    const id = selectedConversationId;
    setDetail(null); setRunStatus(null); setActiveRunId(null); setToolTrace([]); setRunErrorCode(null); setLastGeneratedAt(null);
    if (!id || featureEnabled !== true) { setLoadingDetail(false); return () => { alive = false; }; }
    setLoadingDetail(true);
    getAssistantConversation(id).then((conversation) => {
      if (!alive) return;
      setDetail(conversation);
      // Replaying the latest run also restores source/limitation cards for completed sessions.
      const latestRun = conversation.runs[0];
      if (latestRun && ['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED'].includes(latestRun.status)) {
        setActiveRunId(latestRun.id); setRunStatus(latestRun.status);
        void watchRun(conversation.id, latestRun.id, conversation.projectId);
      }
    }).catch((error) => {
      if (alive) setPageError(error instanceof ApiError ? error.message : '无法读取该会话。');
    }).finally(() => { if (alive) setLoadingDetail(false); });
    return () => {
      alive = false;
      for (const [runId, entry] of watchers.current) {
        if (entry.conversationId === id) entry.controller.abort();
        if (entry.conversationId === id) watchers.current.delete(runId);
      }
    };
  }, [featureEnabled, selectedConversationId, watchRun]);

  const watchSelectedConversationRun = useCallback((conversationId: string, runId: string) => {
    const projectId = detail?.projectId;
    if (!projectId || projectId !== selectedProjectRef.current) return Promise.resolve();
    return watchRun(conversationId, runId, projectId);
  }, [detail?.projectId, watchRun]);

  const handleCreateConversation = async () => {
    if (!selectedProjectId || featureEnabled !== true) return;
    setPageError('');
    try {
      const created = await createAssistantConversation(selectedProjectId);
      await refreshConversationList();
      setSelectedConversationId(created.id);
      const newDetail = await getAssistantConversation(created.id);
      setDetail(newDetail);
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : '无法创建会话。');
    }
  };

  const handleArchive = async (event: ReactMouseEvent<HTMLButtonElement>, conversation: AssistantConversationSummary) => {
    event.stopPropagation();
    try {
      await archiveAssistantConversation(conversation.id);
      if (selectedConversationId === conversation.id) { setSelectedConversationId(null); setDetail(null); }
      await refreshConversationList();
    } catch (error) {
      setPageError(error instanceof ApiError ? error.message : '归档失败。若仍有运行任务，请先取消或等待完成。');
    }
  };

  useEffect(() => () => {
    for (const entry of watchers.current.values()) entry.controller.abort();
    watchers.current.clear();
  }, []);

  if (!selectedProjectId) return <div className="page-wrap"><div className="assistant-unavailable"><ShieldCheck size={26} /><h2>请先选择项目</h2><p>助手只能在已授权的项目上下文中读取成本台账。</p></div></div>;
  if (featureEnabled === null) return <div className="page-wrap"><div className="assistant-unavailable"><RefreshCw size={22} className="assistant-spin" /><p>正在检查成本助手是否已启用……</p></div></div>;
  if (!featureEnabled) return <div className="page-wrap"><div className="assistant-unavailable"><ShieldCheck size={28} /><h2>成本助手暂未启用</h2><p>本功能仍处于默认关闭的只读试点阶段。启用需要管理员完成模型、数据库检查点与权限验证配置。</p></div></div>;
  if (configurationReady === null) return <div className="page-wrap"><div className="assistant-unavailable"><RefreshCw size={22} className="assistant-spin" /><p>正在检查模型与检查点配置……</p></div></div>;
  if (!configurationReady) return <div className="page-wrap"><div className="assistant-unavailable assistant-configuration-unavailable"><ShieldCheck size={28} /><h2>成本助手运行环境未就绪</h2><p>功能开关已开启，但运行时配置不完整。系统只检查配置是否存在，不会显示或记录密钥内容。</p><ul aria-label="缺少的配置">{configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul><p>请由系统维护人员在服务端环境中补齐配置并重启/重新加载服务，再刷新此页面。</p></div></div>;

  return <div className="page-wrap assistant-page">
    <header className="assistant-page-header">
      <div><span className="eyebrow">PROJECT COST INTELLIGENCE</span><h1>成本助手</h1><p>围绕当前项目查询已授权台账、解释差异并整理数据依据。</p></div>
      <div className="assistant-project-chip"><span className="assistant-project-dot" /><span>{selectedProject?.name ?? '当前项目'}</span><small>{selectedProject?.code ?? selectedProjectId}</small><span className="assistant-readonly-badge"><ShieldCheck size={12} />只读模式</span></div>
    </header>
    {pageError && <div className="assistant-page-error" role="alert"><CircleAlert size={16} />{pageError}<button type="button" onClick={() => setPageError('')} aria-label="关闭提示"><X size={15} /></button></div>}
    <section className="assistant-workbench" aria-label="成本助手工作台">
      <aside className="assistant-conversation-rail">
        <div className="assistant-rail-top"><div><span className="assistant-section-kicker">WORKSPACE</span><h2>分析记录</h2></div><button className="assistant-icon-action" type="button" onClick={() => void handleCreateConversation()} aria-label="新建分析" title="新建分析"><Plus size={17} /></button></div>
        <label className="assistant-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索当前项目会话" aria-label="搜索会话" /></label>
        <button type="button" className={`assistant-archived-toggle ${includeArchived ? 'active' : ''}`} onClick={() => setIncludeArchived((value) => !value)}><Archive size={13} />{includeArchived ? '隐藏已归档' : '同时显示已归档'}</button>
        <div className="assistant-session-list" aria-label="会话列表">
          {loadingList && <div className="assistant-list-state"><RefreshCw size={14} className="assistant-spin" />正在读取会话</div>}
          {!loadingList && visibleConversations.length === 0 && <div className="assistant-list-state"><MessageSquare size={19} /><span>{search ? '没有匹配的会话' : includeArchived ? '暂无归档会话' : '还没有分析记录'}</span></div>}
          {visibleConversations.map((conversation) => <div key={conversation.id} className={`assistant-session-row ${conversation.id === selectedConversationId ? 'active' : ''}`}>
            <button type="button" className="assistant-session-select" onClick={() => setSelectedConversationId(conversation.id)}>
              <span className="assistant-session-icon"><MessageSquare size={14} /></span>
              <span className="assistant-session-copy"><strong>{conversation.title}</strong><small>{formatRelativeDate(conversation.lastMessageAt)} · {conversation.messageCount ?? 0} 条消息</small></span>
            </button>
            {conversation.status === 'ACTIVE' && <button type="button" className="assistant-session-archive" onClick={(event) => void handleArchive(event, conversation)} title="归档会话" aria-label={`归档 ${conversation.title}`}><Archive size={13} /></button>}
          </div>)}
        </div>
        <div className="assistant-rail-foot"><ShieldCheck size={14} /><span>会话归属当前用户，查询范围绑定当前项目。</span></div>
      </aside>

      <main className="assistant-conversation-main">
        {!selectedConversationId && !loadingDetail ? <div className="assistant-no-conversation"><div className="assistant-no-conversation-icon"><Sparkles size={22} /></div><h2>开始一项项目分析</h2><p>从左侧创建会话，或选择已有分析记录继续。</p><button type="button" className="assistant-primary-button" onClick={() => void handleCreateConversation()}><Plus size={15} />新建成本分析</button></div>
          : loadingDetail || !projectDetail ? <div className="assistant-main-loading"><RefreshCw size={19} className="assistant-spin" />正在加载会话与历史消息……</div>
          : <>
            <div className="assistant-thread-heading"><div><span className="assistant-thread-live-dot" /><div><h2>{projectDetail.title}</h2><p>{projectDetail.status === 'ARCHIVED' ? '已归档 · 只读历史' : '会话数据范围：当前项目'}</p></div></div><div className="assistant-thread-meta"><span>{projectDetail.messages.length} 条消息</span>{projectDetail.status === 'ARCHIVED' && <span className="assistant-archived-tag">已归档</span>}</div></div>
            <AssistantThread
              key={projectDetail.id}
              conversation={projectDetail}
              onRun={watchSelectedConversationRun}
              activeRunId={activeRunId}
              activeRunStatus={runStatus}
            />
          </>}
      </main>

      <aside className="assistant-evidence-rail">
        <div className="assistant-evidence-header"><div><span className="assistant-section-kicker">TRACE & EVIDENCE</span><h2>分析依据</h2></div><FileSearch size={17} /></div>
        <div className="assistant-scope-card"><span className="assistant-evidence-label">授权数据范围</span><strong>{selectedProject?.name ?? '当前项目'}</strong><p>服务端逐次复核项目权限。模型不能自行更改项目范围。</p></div>
        <div className="assistant-evidence-section assistant-usage-summary">
          <div className="assistant-subsection-heading"><h3>近 {usageSummary?.windowDays ?? 30} 天模型用量</h3><span>{usageSummary ? '按当前用户统计' : 'Token'}</span></div>
          {loadingUsageSummary
            ? <p className="assistant-muted-copy">正在读取用量统计……</p>
            : usageSummaryError
              ? <p className="assistant-muted-copy" role="status">用量统计暂不可用；不会用估算值替代实际用量。</p>
              : usageSummary && <>
                <div className="assistant-usage-metrics">
                  <div><span>已结束任务</span><strong>{formatTokenCount(usageSummary.terminalRuns)}</strong></div>
                  <div><span>进行中</span><strong>{formatTokenCount(usageSummary.activeRuns)}</strong></div>
                  <div><span>完整用量</span><strong>{formatTokenCount(usageSummary.completeRuns)}</strong></div>
                </div>
                <div className="assistant-usage-totals">
                  <div><span>输入</span><strong>{usageSummary.tokens ? formatTokenCount(usageSummary.tokens.inputTokens) : '未知'}</strong></div>
                  <div><span>输出</span><strong>{usageSummary.tokens ? formatTokenCount(usageSummary.tokens.outputTokens) : '未知'}</strong></div>
                  <div><span>合计</span><strong>{usageSummary.tokens ? formatTokenCount(usageSummary.tokens.totalTokens) : '未知'}</strong></div>
                </div>
                <p className="assistant-muted-copy">只汇总供应商完整报告的 token 数，不推算费用。完整 {formatTokenCount(usageSummary.completeRuns)} 次；部分缺失 {formatTokenCount(usageSummary.partialRuns)} 次；供应商未提供 {formatTokenCount(usageSummary.unavailableRuns)} 次。</p>
              </>}
        </div>
        <div className="assistant-evidence-section"><div className="assistant-subsection-heading"><h3>执行状态</h3>{runStatus && <span className={`assistant-run-badge status-${runStatus.toLowerCase()}`}>{runStatusLabel(runStatus)}</span>}</div>
          {!runStatus && <p className="assistant-muted-copy">提交问题后，这里会显示工具执行阶段与状态。</p>}
          {runStatus && <div className="assistant-run-status-line"><span className={`assistant-run-status-mark status-${runStatus.toLowerCase()}`} />{runStatusLabel(runStatus)}{activeRunId && <small>运行 {activeRunId.slice(0, 8)}</small>}</div>}
          {toolTrace.length > 0 && <div className="assistant-tool-list">{toolTrace.map((tool) => <div key={tool.toolId} className="assistant-tool-row"><span className={`assistant-tool-icon ${tool.status.toLowerCase()}`}><Wrench size={13} /></span><span className="assistant-tool-text"><strong>{TOOL_LABELS[tool.toolId] ?? tool.toolId}</strong><small>{tool.status === 'RUNNING' ? '执行中' : tool.status === 'FAILED' ? tool.code ?? '执行失败' : `已完成 · ${tool.sourceCount ?? tool.sources?.length ?? 0} 类来源`}</small></span>{tool.status === 'COMPLETED' && <Check size={13} />}</div>)}</div>}
          {runErrorCode && <div className="assistant-error-code"><CircleAlert size={13} />{humanizeErrorCode(runErrorCode)}</div>}
        </div>
        <div className="assistant-evidence-section"><div className="assistant-subsection-heading"><h3>已读取的数据来源</h3><span>{toolTrace.reduce((sum, tool) => sum + (tool.sources?.length ?? 0), 0)}</span></div>
          {toolTrace.filter((tool) => tool.status === 'COMPLETED' && tool.sources?.length).length === 0
            ? <p className="assistant-muted-copy">工具执行完成后显示服务端返回的来源元数据；此处不会根据模型回答猜测来源。</p>
            : toolTrace.filter((tool) => tool.status === 'COMPLETED').flatMap((tool) => (tool.sources ?? []).map((source, index) => <div key={`${tool.toolId}-${source.entity}-${index}`} className="assistant-source-card"><div className="assistant-source-top"><FileSearch size={14} /><strong>{ENTITY_LABELS[source.entity] ?? source.entity}</strong><span>{source.rowCount} 条</span></div><p>{source.fields.join('、')}</p><small>{source.scope}</small></div>))}
        </div>
        <div className="assistant-evidence-section"><div className="assistant-subsection-heading"><h3>口径与限制</h3><Clock3 size={14} /></div>
          {lastGeneratedAt && <p className="assistant-generated-at">数据生成时间：{new Date(lastGeneratedAt).toLocaleString('zh-CN', { hour12: false })}</p>}
          {toolTrace.flatMap((tool) => tool.limitations ?? []).filter((value, index, all) => all.indexOf(value) === index).map((limitation) => <div className="assistant-limitation" key={limitation}><span />{limitation}</div>)}
          <p className="assistant-muted-copy">来源目前为台账/字段级元数据，不代表每一句回答都已精确引用到单条业务记录。关键金额请核对原始业务页面。</p>
        </div>
        <div className="assistant-evidence-foot"><ShieldCheck size={14} /><span>助手无合同、签证、审批或资金写权限。</span></div>
      </aside>
    </section>
  </div>;
}

function formatTokenCount(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function formatRelativeDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '时间未知';
  const now = Date.now();
  const hours = Math.floor(Math.max(0, now - date.getTime()) / 3600000);
  if (hours < 1) return '刚刚';
  if (hours < 24) return `${hours} 小时前`;
  if (hours < 48) return '昨天';
  return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
}

function runStatusLabel(status: string) {
  return ({ QUEUED: '排队中', RUNNING: '执行中', COMPLETED: '已完成', FAILED: '执行失败', CANCELLED: '已取消' } as Record<string, string>)[status] ?? status;
}

function humanizeErrorCode(code: string) {
  return ({
    ASSISTANT_RUNTIME_NOT_CONFIGURED: '助手运行环境未配置。',
    ASSISTANT_RUNTIME_FAILED: '助手运行失败，未生成可用回答。',
    ASSISTANT_ORPHAN_RUN: '运行记录未关联有效后台任务，系统已将其收敛为失败；可重新提交问题。',
    ASSISTANT_WORKER_LEASE_EXPIRED: '后台执行进程中断，任务未能完成；可重新提交问题。',
    PROJECT_ACCESS_REVOKED: '项目权限已变化，事件流已停止。',
    ASSISTANT_EVENT_STREAM_FAILED: '事件连接中断，请重新打开会话恢复状态。',
    ASSISTANT_DISABLED: '助手已被管理员停用。',
  } as Record<string, string>)[code] ?? `任务未完成（${code}）。`;
}
