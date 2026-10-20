import { useEffect, useState } from 'react';
import { Bot, CheckCircle2, CircleAlert, KeyRound, RefreshCw, Save, Server, ShieldCheck, Sparkles } from 'lucide-react';
import { api, ApiError } from '../api';
import { Button, formatDate, PageHeader } from '../components/Ui';
import SelectField from '../components/SelectField';
import '../styles/assistant-provider.css';

type ProviderModel = { id: string; ownedBy: string | null };
type ProviderConfig = {
  configured: boolean;
  enabled: boolean;
  runtimeSource: 'database' | 'environment' | 'none';
  provider: {
    name: string; baseUrl: string; modelId: string; apiKeyConfigured: boolean; keyVersion: number;
    lastModelsFetchedAt: string | null; lastModelCount: number | null;
    lastTestAt: string | null; lastTestStatus: string | null; lastTestSummary: string | null;
  };
  configuration: { providerConfigured: boolean; modelConfigured: boolean; checkpointConfigured: boolean; checkpointSchemaReady: boolean; endpointValid: boolean; vaultConfigured: boolean };
  configurationReady: boolean;
};

type ModelsResult = { models: ProviderModel[]; latencyMs: number };

export default function AssistantProviderPage() {
  const [config, setConfig] = useState<ProviderConfig | null>(null);
  const [name, setName] = useState('OpenAI 兼容供应商');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [models, setModels] = useState<ProviderModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  function applyConfig(next: ProviderConfig) {
    setConfig(next);
    setName(next.provider.name || 'OpenAI 兼容供应商');
    setBaseUrl(next.provider.baseUrl || '');
    setModelId(next.provider.modelId || '');
    setEnabled(next.enabled);
    if (next.provider.lastModelCount && next.provider.lastModelCount > 0 && models.length === 0) {
      // The server does not persist raw model IDs; keep an explicit empty state until the user fetches again.
    }
  }

  useEffect(() => {
    let alive = true;
    api.get<ProviderConfig>('/system-management/assistant-provider').then((next) => { if (alive) applyConfig(next); })
      .catch((cause) => { if (alive) setError(cause instanceof ApiError ? cause.message : '无法读取 AI 助手配置'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  async function fetchModels() {
    setModelsLoading(true); setError(''); setNotice('');
    try {
      const result = await api.post<ModelsResult>('/system-management/assistant-provider/models', {
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      });
      setModels(result.models);
      if (!modelId && result.models[0]) setModelId(result.models[0].id);
      setNotice('已拉取 ' + result.models.length + ' 个模型 · ' + result.latencyMs + ' ms');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '拉取模型失败');
    } finally {
      setModelsLoading(false);
    }
  }

  async function save() {
    setSaving(true); setError(''); setNotice('');
    try {
      const next = await api.put<ProviderConfig>('/system-management/assistant-provider', {
        name: name.trim() || undefined,
        baseUrl: baseUrl.trim(),
        modelId: modelId.trim(),
        enabled,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
      });
      applyConfig(next);
      setApiKey('');
      setNotice('供应商配置已保存。' + (next.enabled ? '成本助手入口将在成本工作台显示。' : '当前未启用助手。'));
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '保存配置失败');
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true); setError(''); setNotice('');
    try {
      const result = await api.post<{ provider: ProviderConfig; models: ProviderModel[]; latencyMs: number; message: string }>('/system-management/assistant-provider/test');
      setConfig(result.provider);
      setModels(result.models);
      if (!modelId && result.models[0]) setModelId(result.models[0].id);
      setNotice(result.message + ' · ' + result.latencyMs + ' ms');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : '连接测试失败');
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <div className="page-wrap"><div className="assistant-provider-loading">正在读取 AI 助手配置…</div></div>;

  const configuration = config?.configuration;
  const ready = Boolean(config?.configurationReady && enabled);
  return <div className="page-wrap assistant-provider-page">
    <PageHeader
      title="AI 助手配置"
      subtitle="配置 OpenAI 兼容的模型供应商、加密保存密钥，并实时拉取供应商模型；保存并启用后，成本工作台会出现只读成本助手入口。"
      actions={<Button variant="secondary" onClick={() => { setLoading(true); api.get<ProviderConfig>('/system-management/assistant-provider').then(applyConfig).catch(() => setError('刷新失败')).finally(() => setLoading(false)); }}><RefreshCw size={15} />刷新</Button>}
    />

    <section className="assistant-status-strip" aria-label="助手接入状态">
      <div><span>助手开关</span><strong className={enabled ? 'is-ok' : 'is-wait'}>{enabled ? '已启用' : '未启用'}</strong><small>{ready ? '成本助手入口可见' : '保存并启用后出现'}</small></div>
      <div><span>供应商密钥</span><strong className={configuration?.providerConfigured ? 'is-ok' : 'is-wait'}>{configuration?.providerConfigured ? '已配置' : '未配置'}</strong><small>{config?.provider.apiKeyConfigured ? '密钥已加密保存' : '尚未保存密钥'}</small></div>
      <div><span>模型</span><strong className={configuration?.modelConfigured ? 'is-ok' : 'is-wait'}>{configuration?.modelConfigured ? (config?.provider.modelId || '已选择') : '未选择'}</strong><small>{models.length ? '已拉取 ' + models.length + ' 个可选项' : '实时拉取后选择'}</small></div>
      <div><span>检查点 / 队列</span><strong className={configuration?.checkpointSchemaReady ? 'is-ok' : 'is-wait'}>{configuration?.checkpointSchemaReady ? '已就绪' : configuration?.checkpointConfigured ? '待初始化' : '未配置'}</strong><small>PostgreSQL + 后台 worker</small></div>
      <div><span>加密保险库</span><strong className={configuration?.vaultConfigured ? 'is-ok' : 'is-wait'}>{configuration?.vaultConfigured ? '可用' : '缺少密钥'}</strong><small>ASSISTANT_ENCRYPTION_KEY</small></div>
    </section>

    <div className="assistant-provider-layout">
      <section className="assistant-provider-form">
        <div className="assistant-section-head"><div><h2>供应商</h2><p>支持 OpenAI 兼容的 /models 与 chat completions 接口；模型需支持 tool calling。</p></div><Sparkles size={17} /></div>
        <div className="assistant-form-grid">
          <label><span>供应商名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="例如：DeepSeek / 内部网关" /></label>
          <label className="span-2"><span>接口地址 <b>*</b></span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} /><small>地址末尾不要带 /chat/completions；系统会请求 /models。</small></label>
          <label className="span-2"><span>API 密钥 <b>*</b></span><div className="assistant-key-input"><KeyRound size={15} /><input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={config?.provider.apiKeyConfigured ? '已配置；留空保持当前密钥' : '输入供应商 API Key'} /></div><small>密钥只提交到服务端并加密保存，保存后不再回显。</small></label>
          <div className="span-2 assistant-fetch-row"><Button variant="secondary" onClick={() => void fetchModels()} disabled={modelsLoading || !baseUrl.trim() || (!apiKey.trim() && !config?.provider.apiKeyConfigured)}><RefreshCw size={14} />{modelsLoading ? '正在拉取…' : '拉取供应商模型'}</Button>{config?.provider.lastModelsFetchedAt && <span>上次拉取 {formatDate(config.provider.lastModelsFetchedAt)}</span>}</div>
          <div className="span-2 assistant-field"><span>模型 <b>*</b></span>{models.length ? <SelectField value={modelId} onChange={(event) => setModelId(event.target.value)} aria-label="选择供应商模型"><option value="">选择模型</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id}{model.ownedBy ? ' · ' + model.ownedBy : ''}</option>)}{modelId && !models.some((model) => model.id === modelId) && <option value={modelId}>{modelId}（当前保存值）</option>}</SelectField> : <input value={modelId} onChange={(event) => setModelId(event.target.value)} placeholder="先拉取模型，或手动填写模型 ID" spellCheck={false} />}</div>
        </div>
        <div className="assistant-enable-row"><label><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span><strong>启用成本助手</strong><small>启用后，具备项目访问权限的成员可在成本工作台使用只读助手。</small></span></label><span className={ready ? 'assistant-ready is-ok' : 'assistant-ready'}>{ready ? '可进入成本助手' : '尚未满足启用条件'}</span></div>
        {notice && <div className="success-notice"><CheckCircle2 size={15} />{notice}</div>}
        {error && <div className="form-alert">{error}</div>}
        <div className="assistant-form-actions"><Button onClick={() => void save()} disabled={saving || !baseUrl.trim() || !modelId.trim()}><Save size={15} />{saving ? '保存中…' : '保存配置'}</Button><Button variant="secondary" onClick={() => void testConnection()} disabled={testing || !config?.provider.baseUrl || !config?.provider.apiKeyConfigured}><Server size={15} />{testing ? '测试中…' : '测试连接并刷新模型'}</Button></div>
      </section>

      <aside className="assistant-readiness">
        <div className="assistant-section-head"><div><h2>接入检查</h2><p>保存前请逐项确认；密钥不会回显。</p></div><ShieldCheck size={17} /></div>
        <div className="assistant-check-list">
          <div className={configuration?.vaultConfigured ? 'is-ok' : 'is-wait'}>{configuration?.vaultConfigured ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>服务端加密密钥</strong><small>{configuration?.vaultConfigured ? 'ASSISTANT_ENCRYPTION_KEY 已配置' : '缺少 ASSISTANT_ENCRYPTION_KEY，无法保存密钥'}</small></span></div>
          <div className={configuration?.endpointValid ? 'is-ok' : 'is-wait'}>{configuration?.endpointValid && baseUrl.trim() ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>接口地址</strong><small>{baseUrl.trim() ? '当前地址格式有效，保存前仍会由服务端校验' : '填写 OpenAI 兼容接口地址'}</small></span></div>
          <div className={configuration?.providerConfigured ? 'is-ok' : 'is-wait'}>{configuration?.providerConfigured ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>供应商密钥</strong><small>{configuration?.providerConfigured ? '已保存加密密钥；只显示配置状态' : '填写并保存 API Key'}</small></span></div>
          <div className={configuration?.modelConfigured ? 'is-ok' : 'is-wait'}>{configuration?.modelConfigured ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>模型选择</strong><small>{configuration?.modelConfigured ? config?.provider.modelId : '拉取模型后选择'}</small></span></div>
          <div className={configuration?.checkpointSchemaReady ? 'is-ok' : 'is-wait'}>{configuration?.checkpointSchemaReady ? <CheckCircle2 size={14} /> : <CircleAlert size={14} />}<span><strong>LangGraph 检查点</strong><small>{configuration?.checkpointSchemaReady ? 'moheng_assistant schema 已初始化' : configuration?.checkpointConfigured ? '连接串已配置；请运行 assistant:checkpoint:setup 初始化 schema' : '未配置检查点数据库'}</small></span></div>
        </div>
        <div className="assistant-aside-note"><Bot size={15} /><p>连接测试只验证 /models 可达，不代表模型已经通过工具调用、金额口径和越权拒绝验收。第一次启用建议只用测试项目。</p></div>
        {config?.provider.lastTestStatus && <div className={config.provider.lastTestStatus === 'SUCCEEDED' ? 'assistant-last-test is-ok' : 'assistant-last-test is-wait'}><span>最近测试 · {formatDate(config.provider.lastTestAt)}</span><strong>{config.provider.lastTestStatus}{config.provider.lastTestSummary ? ' · ' + config.provider.lastTestSummary : ''}</strong></div>}
      </aside>
    </div>
  </div>;
}
