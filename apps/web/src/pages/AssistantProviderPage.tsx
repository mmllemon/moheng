import { type MouseEvent, useEffect, useState } from 'react';
import { Bot, Check, CheckCircle2, ChevronDown, CircleAlert, Eye, EyeOff, KeyRound, Plus, RefreshCw, Save, Search, Server } from 'lucide-react';
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
  const [showKey, setShowKey] = useState(false);
  const [addedModelIds, setAddedModelIds] = useState<string[]>([]);
  const [extraModels, setExtraModels] = useState<ProviderModel[]>([]);
  const [modelPicker, setModelPicker] = useState<{ top: number; left: number; width: number } | null>(null);
  const [modelSearch, setModelSearch] = useState('');
  const [customModelId, setCustomModelId] = useState('');
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
    if (modelId) setAddedModelIds((prev) => prev.includes(modelId) ? prev : [...prev, modelId]);
  }, [modelId]);

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
  const knownModels = [...models, ...extraModels.filter((extra) => !models.some((model) => model.id === extra.id))];
  const addedModels = addedModelIds.map((id) => knownModels.find((model) => model.id === id) ?? { id, ownedBy: null });
  const pickerModels = (knownModels.length ? knownModels : addedModels).filter((model) => !modelSearch.trim() || model.id.toLowerCase().includes(modelSearch.trim().toLowerCase()));

  function toggleModel(id: string) {
    const has = addedModelIds.includes(id);
    const next = has ? addedModelIds.filter((modelIdValue) => modelIdValue !== id) : [...addedModelIds, id];
    setAddedModelIds(next);
    if (has) {
      if (modelId === id) setModelId(next[0] ?? '');
    } else {
      setModelId(id);
    }
  }

  function addCustomModel() {
    const id = customModelId.trim();
    if (!id) return;
    if (!knownModels.some((model) => model.id === id)) setExtraModels((prev) => [...prev, { id, ownedBy: null }]);
    if (!addedModelIds.includes(id)) setAddedModelIds((prev) => [...prev, id]);
    setModelId(id);
    setCustomModelId('');
  }

  function openModelPicker(event: MouseEvent<HTMLButtonElement>) {
    if (modelPicker) { setModelPicker(null); return; }
    const rect = event.currentTarget.getBoundingClientRect();
    const width = Math.min(360, window.innerWidth - rect.left - 16);
    setModelPicker({ top: rect.bottom + 6, left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), width });
  }
  const checks = [
    { label: '服务端加密密钥', hint: configuration?.vaultConfigured ? 'ASSISTANT_ENCRYPTION_KEY 已配置。' : '缺少 ASSISTANT_ENCRYPTION_KEY，无法保存密钥。', ok: Boolean(configuration?.vaultConfigured), pass: '已配置', wait: '缺少密钥' },
    { label: '接口地址', hint: baseUrl.trim() ? '当前地址格式有效，保存前仍会由服务端校验。' : '填写 OpenAI 兼容接口地址。', ok: Boolean(configuration?.endpointValid && baseUrl.trim()), pass: '格式有效', wait: '待填写' },
    { label: '供应商密钥', hint: configuration?.providerConfigured ? '已保存加密密钥；只显示配置状态。' : '填写并保存 API Key。', ok: Boolean(configuration?.providerConfigured), pass: '已保存', wait: '待保存' },
    { label: '模型选择', hint: configuration?.modelConfigured ? (config?.provider.modelId || '已选择') : '拉取模型后选择。', ok: Boolean(configuration?.modelConfigured), pass: '已选择', wait: '待选择' },
    { label: 'LangGraph 检查点', hint: configuration?.checkpointSchemaReady ? 'moheng_assistant schema 已初始化。' : configuration?.checkpointConfigured ? '连接串已配置；请运行 assistant:checkpoint:setup 初始化 schema。' : '未配置检查点数据库。', ok: Boolean(configuration?.checkpointSchemaReady), pass: '已就绪', wait: '待初始化' },
  ];
  return <div className="page-wrap assistant-provider-page">
    <PageHeader
      title="AI 助手配置"
      subtitle="配置 OpenAI 兼容的模型供应商、加密保存密钥；保存并启用后，成本工作台会出现只读成本助手入口。"
      actions={<Button variant="secondary" onClick={() => { setLoading(true); api.get<ProviderConfig>('/system-management/assistant-provider').then(applyConfig).catch(() => setError('刷新失败')).finally(() => setLoading(false)); }}><RefreshCw size={15} />刷新</Button>}
    />

    {notice && <div className="success-notice"><CheckCircle2 size={15} />{notice}</div>}
    {error && <div className="form-alert">{error}</div>}

    <section className="assistant-provider-shell" aria-label="AI 助手供应商设置">
      <aside className="assistant-provider-rail" aria-label="供应商目录">
        <div className="assistant-rail-head"><span>已注册的供应商</span><b>1</b></div>
        <div className="assistant-rail-group">API</div>
        <button type="button" className="assistant-rail-item is-active" aria-current="true">
          <span className="assistant-rail-mark"><Bot size={15} /></span>
          <span className="assistant-rail-copy"><strong>{name || 'OpenAI Compatible'}</strong><small>OpenAI 兼容</small></span>
          <span className="assistant-rail-count">{addedModels.length}</span>
        </button>
      </aside>

      <div className="assistant-provider-detail">
        <header className="assistant-detail-head">
          <div><span className="eyebrow">PROVIDER / OPENAI COMPATIBLE</span><h2>{name || 'OpenAI Compatible'}</h2><p>{baseUrl || '尚未配置接口地址'}</p></div>
          <div className="assistant-detail-state">
            <button type="button" role="switch" aria-checked={enabled} aria-label="启用成本助手" className={'ui-switch ' + (enabled ? 'is-on' : '')} onClick={() => setEnabled((value) => !value)}><i /></button>
          </div>
        </header>

        <div className="assistant-provider-form">
          <div className="assistant-field"><span>API Key</span><div className="assistant-key-line"><KeyRound size={14} /><input type={showKey ? 'text' : 'password'} value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="new-password" placeholder={config?.provider.apiKeyConfigured ? '已配置；留空保持当前密钥' : '输入供应商 API Key'} aria-label="API 密钥" /><button type="button" className="assistant-inline-button" onClick={() => setShowKey((value) => !value)}>{showKey ? <EyeOff size={13} /> : <Eye size={13} />}{showKey ? '隐藏' : '显示'}</button><button type="button" className="assistant-inline-button" onClick={() => void testConnection()} disabled={testing || !config?.provider.baseUrl || !config?.provider.apiKeyConfigured}>{testing ? '检测中…' : '检测'}</button></div></div>
          <label className="assistant-field"><span>Base URL</span><input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com/v1" spellCheck={false} aria-label="接口地址" /></label>
          <div className="assistant-field"><span>API 类型</span><SelectField value="openai" disabled aria-label="API 类型"><option value="openai">OpenAI Compatible</option></SelectField></div>
        </div>

        <div className="assistant-model-tabs" role="tablist" aria-label="模型类型"><button type="button" role="tab" aria-selected="true" className="is-active">对话模型</button><button type="button" role="tab" aria-selected="false" disabled title="当前版本仅支持对话模型">语音转录模型</button></div>
        <div className="assistant-added-label">已添加的模型 <b>{addedModels.length}</b></div>
        <div className="assistant-model-list">
          {addedModels.length ? addedModels.map((model) => <button type="button" key={model.id} className={'assistant-model-item ' + (model.id === modelId ? 'is-selected' : '')} onClick={() => setModelId(model.id)}><span>{model.id}</span><small>{model.ownedBy || 'OpenAI Compatible'}</small>{model.id === modelId && <Check size={14} />}</button>) : <div className="assistant-model-empty">读取供应商模型后，从“添加模型”中选择要加入的对话模型。</div>}
        </div>
        <div className="assistant-model-add">
          <button type="button" className="assistant-model-add-trigger" aria-expanded={Boolean(modelPicker)} aria-haspopup="listbox" onClick={openModelPicker}><span>添加模型</span><ChevronDown size={14} /></button>
          <Button variant="ghost" size="sm" onClick={() => void fetchModels()} disabled={modelsLoading || !baseUrl.trim() || (!apiKey.trim() && !config?.provider.apiKeyConfigured)}><RefreshCw size={14} />{modelsLoading ? '读取中…' : '读取模型'}</Button>
          {modelPicker && <div className="assistant-model-picker" style={{ position: 'fixed', top: modelPicker.top, left: modelPicker.left, width: modelPicker.width }} onKeyDown={(event) => { if (event.key === 'Escape') setModelPicker(null); }}>
            <div className="assistant-model-picker-search"><Search size={14} /><input value={modelSearch} onChange={(event) => setModelSearch(event.target.value)} placeholder="搜索模型…" aria-label="搜索模型" autoFocus /></div>
            <div className="assistant-model-picker-list" role="listbox" aria-label="可添加模型" aria-multiselectable="true">
              {pickerModels.length ? pickerModels.map((model) => { const isAdded = addedModelIds.includes(model.id); return <button type="button" role="option" aria-selected={isAdded} key={model.id} className={'assistant-model-option ' + (isAdded ? 'is-added' : '')} onClick={() => toggleModel(model.id)}><span className="assistant-model-option-check">{isAdded ? <Check size={13} /> : null}</span><strong>{model.id}</strong><small>{model.ownedBy || 'OpenAI Compatible'}</small></button>; }) : <div className="assistant-model-picker-empty">先读取供应商模型，或直接输入自定义模型 ID。</div>}
            </div>
            <div className="assistant-model-custom"><input value={customModelId} onChange={(event) => setCustomModelId(event.target.value)} placeholder="输入 ID 添加自定义模型" aria-label="自定义模型 ID" /><button type="button" onClick={addCustomModel} aria-label="添加自定义模型"><Plus size={14} /></button></div>
          </div>}
        </div>

        <div className="assistant-detail-footer">
          <span className="assistant-footer-note">{config?.provider.lastTestStatus ? '最近测试 · ' + formatDate(config.provider.lastTestAt) + ' · ' + config.provider.lastTestStatus : '连接测试只验证 /models 可达，不代表工具调用与金额口径已验收。'}</span>
          <div className="assistant-detail-actions"><Button variant="secondary" onClick={() => void testConnection()} disabled={testing || !config?.provider.baseUrl || !config?.provider.apiKeyConfigured}><Server size={15} />{testing ? '测试中…' : '测试连接'}</Button><Button onClick={() => void save()} disabled={saving || !baseUrl.trim() || !modelId.trim()}><Save size={15} />{saving ? '保存中…' : '保存配置'}</Button></div>
        </div>
      </div>
    </section>

    <details className="assistant-check-panel">
      <summary className="assistant-check-summary"><span>接入检查</span><span className={'assistant-check-pill ' + (ready ? 'is-ok' : 'is-wait')}>{ready ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{ready ? '可启用' : '待完善'}</span></summary>
      <div className="assistant-check-head"><p>保存前逐项确认；密钥不会回显，连接测试只验证 /models 可达。</p></div>
      <div className="assistant-check-grid">{checks.map((check) => <div className="assistant-check-item" key={check.label}><div><strong>{check.label}</strong><p>{check.hint}</p></div><span className={'assistant-check-pill ' + (check.ok ? 'is-ok' : 'is-wait')}>{check.ok ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}{check.ok ? check.pass : check.wait}</span></div>)}</div>
      <div className="inline-notice"><Bot size={16} /><span>连接测试只验证 /models 可达，不代表模型已经通过工具调用、金额口径和越权拒绝验收。第一次启用建议只用测试项目。</span></div>
    </details>
  </div>;
}
