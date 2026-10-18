import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Eye, FileSpreadsheet, Grid2X2Plus, Link2, LoaderCircle, Save, Send, Trash2 } from 'lucide-react';
import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import SelectField from '../components/SelectField';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';
import { createDefaultStudioDefinition } from '../report-studio-default';
import type { ReportStudioBinding, ReportStudioDefinition, ReportStudioDomain, ReportStudioRegion, ReportStudioSource, ReportStudioTemplate } from '../report-studio-types';
import UniverPresetSheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import '@univerjs/preset-sheets-core/lib/index.css';

interface UniverRangeLike { setValue?: (value: unknown) => unknown; getValue?: () => unknown }
interface UniverSheetLike { getSheetId?: () => string; getId?: () => string; getSelection?: () => { getActiveRange?: () => { getA1Notation?: () => string } }; getRange?: (address: string) => UniverRangeLike }
interface UniverApiLike {
  createWorkbook: (data: unknown) => unknown;
  getActiveWorkbook: () => { save: () => unknown; getActiveSheet?: () => UniverSheetLike | null; getSheetBySheetId?: (sheetId: string) => UniverSheetLike | null; getActiveRange?: () => { getA1Notation?: () => string } | null } | null;
}
function clearBindingPlaceholder(api: UniverApiLike | undefined, binding: ReportStudioBinding) {
  if (!api) return;
  const workbook = api.getActiveWorkbook();
  const activeSheet = workbook?.getActiveSheet?.() ?? null;
  const activeSheetId = activeSheet?.getSheetId?.() ?? activeSheet?.getId?.();
  const sheet = workbook?.getSheetBySheetId?.(binding.sheetId)
    ?? (activeSheetId === binding.sheetId ? activeSheet : null);
  const range = sheet?.getRange?.(binding.cell);
  const expectedPlaceholder = `{{${binding.sourceId}.${binding.fieldId}}}`;
  // Preserve any user-edited value; only clear the inert marker inserted by the binding action.
  if (range?.getValue && range.getValue() === expectedPlaceholder) range.setValue?.('');
}
interface UniverInstanceLike { dispose: () => void }
interface StudioCatalogResult { domain: ReportStudioDomain; sources: ReportStudioSource[] }

function parseA1(address: string) {
  const match = /^\$?([A-Z]{1,3})\$?([1-9]\d{0,3})$/i.exec(address.trim());
  if (!match) throw new Error('单元格地址不正确，请使用 A1、B3 等地址。');
  let column = 0;
  for (const char of match[1]!.toUpperCase()) column = column * 26 + char.charCodeAt(0) - 64;
  return { row: Number(match[2]) - 1, column: column - 1 };
}
function parseRange(range: string) {
  const parts = range.replace(/\$/g, '').toUpperCase().split(':');
  const start = parseA1(parts[0] ?? '');
  const end = parseA1(parts[1] ?? parts[0] ?? '');
  return { start, end };
}
function newId(prefix: string) { return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`; }
export default function ReportStudioPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const currentUser = useAuthStore((state) => state.user);
  const [domain, setDomain] = useState<ReportStudioDomain>(searchParams.get('domain') === 'COMPANY' ? 'COMPANY' : searchParams.get('domain') === 'PARTY' ? 'PARTY' : 'PROJECT');
  const [projectId, setProjectId] = useState(searchParams.get('projectId') || selectedProjectId || '');
  const [businessPartyId, setBusinessPartyId] = useState(searchParams.get('partyId') || '');
  const [templateId, setTemplateId] = useState(searchParams.get('templateId') || '');
  const [templateVersion, setTemplateVersion] = useState(1);
  const [templateEditable, setTemplateEditable] = useState(true);
  const [templateScope, setTemplateScope] = useState<'PERSONAL' | 'PROJECT' | 'SYSTEM'>('PERSONAL');
  const [name, setName] = useState(domain === 'PROJECT' ? '项目综合经营报告' : domain === 'PARTY' ? '往来单位经营档案报告' : '公司经营汇总报告');
  const [description, setDescription] = useState('由墨衡报表工作室创建。数据按当前账号有权访问的项目读取。');
  const [definition, setDefinition] = useState<ReportStudioDefinition>(() => createDefaultStudioDefinition(searchParams.get('domain') === 'COMPANY' ? 'COMPANY' : searchParams.get('domain') === 'PARTY' ? 'PARTY' : 'PROJECT'));
  const definitionRef = useRef(definition);
  definitionRef.current = definition;
  const hostRef = useRef<HTMLDivElement>(null);
  const instanceRef = useRef<{ univer: UniverInstanceLike; api: UniverApiLike } | null>(null);
  const [ready, setReady] = useState(false);
  const [editorInitialized, setEditorInitialized] = useState(false);
  const autoPreviewRequested = searchParams.get('autoPreview') === '1';
  const openSavedTemplateRequested = searchParams.get('openSavedTemplate') === '1';
  const autoPreviewTriggered = useRef(false);
  const [editorGeneration, setEditorGeneration] = useState(0);
  const [editorError, setEditorError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [selectedCell, setSelectedCell] = useState('B3');
  const [selectedRange, setSelectedRange] = useState('B3');
  const [selectedSheetId, setSelectedSheetId] = useState('sheet1');
  const [sourceId, setSourceId] = useState(domain === 'PROJECT' ? 'project' : domain === 'PARTY' ? 'businessParty' : 'companyProjects');
  const [fieldId, setFieldId] = useState('name');
  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Array<{ id: string; name: string; code: string }>>('/projects') });
  const catalogQuery = useQuery({ queryKey: ['report-studio-catalog', domain], queryFn: () => api.get<StudioCatalogResult>(`/reports/studio/catalog?domain=${domain}`) });
  const templatesQuery = useQuery({
    queryKey: ['report-studio-templates', domain, projectId, businessPartyId],
    queryFn: () => api.get<ReportStudioTemplate[]>(`/reports/studio/templates?domain=${domain}${domain === 'PROJECT' && projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}${domain === 'PARTY' && businessPartyId ? `&businessPartyId=${encodeURIComponent(businessPartyId)}` : ''}`),
    enabled: domain === 'COMPANY' || (domain === 'PROJECT' && Boolean(projectId)) || (domain === 'PARTY' && Boolean(businessPartyId)),
  });
  const sources = catalogQuery.data?.sources ?? [];
  const selectedSource = sources.find((source) => source.id === sourceId);
  const selectedField = selectedSource?.fields.find((field) => field.id === fieldId);
  const sheetIdFromDefinition = (definition.workbook.sheetOrder as string[] | undefined)?.[0] ?? 'sheet1';

  useEffect(() => {
    let active = true;
    async function loadTemplate() {
      setReady(false); setEditorInitialized(false); setEditorError(''); setError(''); setNotice('');
      if (!templateId) {
        if ((autoPreviewRequested || openSavedTemplateRequested) && !templatesQuery.isFetched) return;
        const existingPersonal = (autoPreviewRequested || openSavedTemplateRequested) ? templatesQuery.data?.find((item) => item.domain === domain && item.scope === 'PERSONAL' && item.editable !== false) : undefined;
        if (existingPersonal) { setTemplateId(existingPersonal.id); return; }
        const next = createDefaultStudioDefinition(domain);
        if (active) {
          setDefinition(next); setEditorGeneration((value) => value + 1); setTemplateVersion(1); setTemplateScope('PERSONAL'); setTemplateEditable(true);
          setName(domain === 'PROJECT' ? '项目综合经营报告' : domain === 'PARTY' ? '往来单位经营档案报告' : '公司经营汇总报告');
          setDescription(next.description); setReady(true);
        }
        return;
      }
      try {
        const template = await api.get<ReportStudioTemplate & { editable: boolean }>(`/reports/studio/templates/${templateId}`);
        if (!active) return;
        if (template.domain && template.domain !== domain) {
          setDomain(template.domain); setTemplateId(''); return;
        }
        setDefinition(template.definition); setEditorGeneration((value) => value + 1); setTemplateVersion(template.version); setTemplateEditable(template.editable !== false); setTemplateScope(template.editable === false ? 'PERSONAL' : template.scope);
        setName(template.name); setDescription(template.description); setReady(true);
      } catch (cause) {
        if (!active) return;
        setError(cause instanceof Error ? cause.message : '模板读取失败。');
        setReady(true);
      }
    }
    void loadTemplate();
    return () => { active = false; };
  }, [templateId, domain, autoPreviewRequested, openSavedTemplateRequested, templatesQuery.isFetched, templatesQuery.data]);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    let cancelled = false;
    let localInstance: { univer: UniverInstanceLike; api: UniverApiLike } | null = null;
    async function initEditor() {
      try {
        const [{ createUniver, LocaleType, mergeLocales }, { UniverSheetsCorePreset }] = await Promise.all([
          import('@univerjs/presets'), import('@univerjs/preset-sheets-core'),
        ]);
        if (cancelled || !hostRef.current) return;
        const container = document.createElement('div');
        container.className = 'report-studio-univer-root';
        hostRef.current.replaceChildren(container);
        const created = createUniver({
          locale: LocaleType.ZH_CN,
          locales: { [LocaleType.ZH_CN]: mergeLocales(UniverPresetSheetsCoreZhCN) },
          presets: [UniverSheetsCorePreset({ container })],
        });
        created.univerAPI.createWorkbook(definitionRef.current.workbook as never);
        localInstance = { univer: created.univer, api: created.univerAPI as unknown as UniverApiLike };
        instanceRef.current = localInstance;
        setEditorError('');
        setEditorInitialized(true);
      } catch (cause) {
        if (!cancelled) setEditorError(`电子表格编辑器初始化失败：${cause instanceof Error ? cause.message : '未知错误'}。请检查固定版本的 Univer 依赖是否安装完整。`);
      }
    }
    void initEditor();
    return () => {
      cancelled = true;
      const instance = localInstance ?? instanceRef.current;
      instanceRef.current = null;
      if (instance) queueMicrotask(() => { instance.univer.dispose(); });
      hostRef.current?.replaceChildren();
    };
  }, [ready, editorGeneration]);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    params.set('domain', domain);
    if (domain === 'PROJECT' && projectId) params.set('projectId', projectId); else params.delete('projectId');
    if (domain === 'PARTY' && businessPartyId) params.set('partyId', businessPartyId); else params.delete('partyId');
    if (templateId) params.set('templateId', templateId); else params.delete('templateId');
    if (params.toString() !== searchParams.toString()) setSearchParams(params, { replace: true });
  }, [domain, projectId, businessPartyId, templateId, searchParams, setSearchParams]);

  const sourceOptions = useMemo(() => sources.map((source) => ({ id: source.id, label: `${source.label}${source.cardinality === 'MANY' ? ' · 明细集合' : ' · 单条数据'}` })), [sources]);
  const fieldOptions = selectedSource?.fields ?? [];

  const snapshotDefinition = useCallback((): ReportStudioDefinition => {
    const activeWorkbook = instanceRef.current?.api.getActiveWorkbook();
    const snapshot = activeWorkbook?.save();
    return { ...definitionRef.current, workbook: (snapshot && typeof snapshot === 'object' ? snapshot : definitionRef.current.workbook) as Record<string, unknown> };
  }, []);

  const readActiveSelection = useCallback(() => {
    try {
      const workbook = instanceRef.current?.api.getActiveWorkbook();
      const sheet = workbook?.getActiveSheet?.();
      const range = workbook?.getActiveRange?.();
      const address = range?.getA1Notation?.()?.replace(/\$/g, '').toUpperCase();
      if (address) {
        const firstCell = address.split(':')[0] ?? address;
        parseA1(firstCell);
        setSelectedRange(address); setSelectedCell(firstCell);
      }
      const id = sheet?.getSheetId?.() ?? sheet?.getId?.();
      if (id) setSelectedSheetId(id);
      setNotice(address ? `已读取当前选区：${address}` : '无法读取当前选区，请在地址框中输入单元格地址。');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取当前选区失败。');
    }
  }, []);

  const saveTemplate = useCallback(async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const captured = snapshotDefinition();
      const checkedProjectId = domain === 'PROJECT' ? projectId : undefined;
      const checkedPartyId = domain === 'PARTY' ? businessPartyId : undefined;
      if (domain === 'PROJECT' && !checkedProjectId) throw new Error('请先选择项目。');
      if (domain === 'PARTY' && !checkedPartyId) throw new Error('请从往来单位经营档案进入报表工作室。');
      let saved: ReportStudioTemplate;
      if (templateId && templateEditable) {
        saved = await api.patch<ReportStudioTemplate>(`/reports/studio/templates/${templateId}`, { name, description, expectedVersion: templateVersion, definition: captured });
      } else {
        saved = await api.post<ReportStudioTemplate>('/reports/studio/templates', {
          domain, name, description, scope: templateScope,
          projectId: templateScope === 'PROJECT' || domain === 'PROJECT' ? checkedProjectId ?? null : null,
          businessPartyId: checkedPartyId ?? null,
          definition: captured,
        });
        setTemplateId(saved.id);
      }
      setTemplateEditable(true); setDefinition(captured); setTemplateVersion(saved.version); setNotice(`模板已保存为 v${saved.version}。`);
      void templatesQuery.refetch();
      return saved;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存模板失败。');
      throw cause;
    } finally { setBusy(false); }
  }, [snapshotDefinition, domain, projectId, businessPartyId, templateId, templateEditable, name, description, templateVersion, templateScope, templatesQuery]);

  function cleanStudioPath(savedTemplateId?: string) {
    const params = new URLSearchParams(searchParams);
    params.delete('autoPreview');
    params.delete('openSavedTemplate');
    params.delete('returnTo');
    params.set('domain', domain);
    if (domain === 'PROJECT' && projectId) params.set('projectId', projectId); else params.delete('projectId');
    if (domain === 'PARTY' && businessPartyId) params.set('partyId', businessPartyId); else params.delete('partyId');
    if (savedTemplateId) params.set('templateId', savedTemplateId);
    else if (templateId) params.set('templateId', templateId);
    else params.delete('templateId');
    const query = params.toString();
    return `${location.pathname}${query ? `?${query}` : ''}`;
  }

  function validInternalPath(candidate: string | null): candidate is string {
    return Boolean(candidate && candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.includes('\\') && !/[\u0000-\u001f]/.test(candidate));
  }

  async function preview(automatic = false) {
    try {
      const saved = await saveTemplate();
      const params = new URLSearchParams({ studioTemplateId: saved.id, domain });
      if (domain === 'PROJECT' && projectId) params.set('projectId', projectId);
      if (domain === 'PARTY' && businessPartyId) params.set('partyId', businessPartyId);
      const cleanReturnPath = cleanStudioPath(saved.id);
      const sourcePath = searchParams.get('returnTo');
      const returnTo = automatic && validInternalPath(sourcePath) ? sourcePath : cleanReturnPath;
      params.set('returnTo', returnTo);
      const canGoBackInHistory = automatic ? validInternalPath(sourcePath) : true;
      navigate(`/reports/preview?${params.toString()}`, {
        replace: automatic,
        state: { safeReportPreviewBack: canGoBackInHistory, returnTo },
      });
    } catch { /* saveTemplate displays the actionable error */ }
  }

  async function publishTemplate() {
    try {
      const saved = await saveTemplate();
      const published = await api.post<ReportStudioTemplate>(`/reports/studio/templates/${saved.id}/publish`, {});
      setTemplateId(published.id); setTemplateVersion(published.version); setTemplateEditable(true);
      setNotice('模板已发布，新版本可按共享范围使用。'); void templatesQuery.refetch();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '发布模板失败。'); }
  }

  function changeDomain(next: ReportStudioDomain) {
    if (next === domain) return;
    setDomain(next); setTemplateId(''); setDefinition(createDefaultStudioDefinition(next)); setEditorGeneration((value) => value + 1); setTemplateVersion(1); setTemplateScope('PERSONAL');
    setSourceId(next === 'PROJECT' ? 'project' : next === 'PARTY' ? 'businessParty' : 'companyProjects'); setName(next === 'PROJECT' ? '项目综合经营报告' : next === 'PARTY' ? '往来单位经营档案报告' : '公司经营汇总报告');
  }

  useEffect(() => {
    if (!autoPreviewRequested || autoPreviewTriggered.current || !ready || !editorInitialized || editorError) return;
    if (domain === 'PROJECT' && !projectId) { setError('请先选择项目。'); return; }
    if (domain === 'PARTY' && !businessPartyId) { setError('请从往来单位经营档案页面进入报表工作室。'); return; }
    autoPreviewTriggered.current = true;
    // Workspace shortcuts should preview an existing saved template without silently incrementing its version.
    const cleanReturnPath = cleanStudioPath(templateId);
    const sourcePath = searchParams.get('returnTo');
    const canGoBackInHistory = validInternalPath(sourcePath);
    const returnTo = canGoBackInHistory ? sourcePath : cleanReturnPath;
    if (templateId) {
      const params = new URLSearchParams({ studioTemplateId: templateId, domain, returnTo });
      if (domain === 'PROJECT' && projectId) params.set('projectId', projectId);
      if (domain === 'PARTY' && businessPartyId) params.set('partyId', businessPartyId);
      navigate(`/reports/preview?${params.toString()}`, { replace: true, state: { safeReportPreviewBack: canGoBackInHistory, returnTo } });
    } else {
      // Replace the one-shot auto-preview route. Returning must not revisit autoPreview=1 and open the same preview again.
      void preview(true);
    }
  }, [autoPreviewRequested, ready, editorInitialized, editorError, domain, projectId, businessPartyId, templateId, navigate, location.pathname, searchParams]);

  function addBinding() {
    try {
      const address = selectedCell.trim().toUpperCase();
      const coordinate = parseA1(address);
      const sheetId = selectedSheetId || sheetIdFromDefinition;
      if (!selectedSource || !selectedField) throw new Error('请先选择有效的数据源和字段。');
      if (selectedSource.cardinality === 'MANY') {
        const matchingRegion = definition.regions.some((region) => region.sheetId === sheetId && region.sourceId === sourceId && region.templateRow === coordinate.row && coordinate.column >= region.startColumn && coordinate.column <= region.endColumn);
        if (!matchingRegion) throw new Error('集合字段需要先创建重复区域：选中该明细样板行的整个列范围，点击“设置为自动延伸区域”，再绑定其中的单元格。');
      } else if (definition.regions.some((region) => region.sheetId === sheetId && region.templateRow === coordinate.row)) {
        throw new Error('单条记录字段不能放在重复区域样板行中，请先移除该行重复区域或选择其他行。');
      }
      const binding: ReportStudioBinding = { id: newId('binding'), sheetId, cell: address, sourceId, fieldId, format: selectedField.type === 'MONEY' ? 'MONEY' : selectedField.type === 'DATE' ? 'DATE' : selectedField.type === 'NUMBER' ? 'NUMBER' : 'AUTO' };
      const placeholder = `{{${selectedSource.id}.${selectedField.id}}}`;
      const sheet = instanceRef.current?.api.getActiveWorkbook()?.getActiveSheet?.();
      // Keep the binding visible while editing; the renderer replaces this inert placeholder with real data.
      try { sheet?.getRange?.(address)?.setValue?.(placeholder); } catch { /* editor selection APIs can be unavailable until the first workbook activation */ }
      setDefinition((current) => ({ ...current, bindings: [...current.bindings.filter((item) => !(item.sheetId === sheetId && item.cell === address)), binding] }));
      setNotice(`${address} 已绑定 ${selectedSource.label} · ${selectedField.label}。保存模板后生效。`); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '绑定字段失败。'); }
  }

  function addRegion() {
    try {
      if (!selectedSource || selectedSource.cardinality !== 'MANY') throw new Error('请先选择“明细集合”数据源。');
      const { start, end } = parseRange(selectedRange);
      if (start.row !== end.row) throw new Error('第一阶段重复区域必须选择单行样板区域，请选择如 A10:F10。');
      if (start.column > end.column) throw new Error('选区起止列不正确。');
      const sheetId = selectedSheetId || sheetIdFromDefinition;
      const region: ReportStudioRegion = { id: newId('region'), sheetId, sourceId, templateRow: start.row, startColumn: start.column, endColumn: end.column, maxRows: 10000 };
      const previousRegion = definition.regions.find((item) => item.sheetId === sheetId && item.templateRow === start.row);
      const sourceCardinalityById = new Map(sources.map((item) => [item.id, item.cardinality] as const));
      const bindingsToRemove = definition.bindings.filter((binding) => {
        if (binding.sheetId !== sheetId) return false;
        try {
          const coordinate = parseA1(binding.cell);
          if (coordinate.row !== start.row) return false;
          // The validator forbids single-record bindings anywhere on a repeating row,
          // even outside the selected region's columns.
          if (sourceCardinalityById.get(binding.sourceId) === 'ONE') return true;
          if (!previousRegion || binding.sourceId !== previousRegion.sourceId) return false;
          if (coordinate.row !== previousRegion.templateRow || coordinate.column < previousRegion.startColumn || coordinate.column > previousRegion.endColumn) return false;
          return binding.sourceId !== sourceId || coordinate.column < start.column || coordinate.column > end.column;
        } catch { return false; }
      });
      bindingsToRemove.forEach((binding) => clearBindingPlaceholder(instanceRef.current?.api, binding));
      const removedBindingIds = new Set(bindingsToRemove.map((binding) => binding.id));
      setDefinition((current) => ({
        ...current,
        regions: [...current.regions.filter((item) => !(item.sheetId === sheetId && item.templateRow === start.row)), region],
        bindings: current.bindings.filter((binding) => !removedBindingIds.has(binding.id)),
      }));
      setNotice(`已将 ${selectedRange} 设置为 ${selectedSource.label} 的自动延伸行。请为样板行中的每个单元格绑定字段。`); setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '创建重复区域失败。'); }
  }

  function removeBinding() {
    const address = selectedCell.trim().toUpperCase();
    const sheetId = selectedSheetId || sheetIdFromDefinition;
    const removed = definition.bindings.find((binding) => binding.sheetId === sheetId && binding.cell === address);
    if (removed) clearBindingPlaceholder(instanceRef.current?.api, removed);
    setDefinition((current) => ({ ...current, bindings: current.bindings.filter((binding) => binding.sheetId !== sheetId || binding.cell !== address) }));
    setNotice(`已移除 ${address} 的字段绑定。`);
  }

  function removeSelectedRegion() {
    try {
      const { start } = parseRange(selectedRange);
      const sheetId = selectedSheetId || sheetIdFromDefinition;
      const removed = definition.regions.find((region) => region.sheetId === sheetId && region.templateRow === start.row);
      if (!removed) throw new Error('当前行没有重复区域。');
      const bindingsToRemove = definition.bindings.filter((binding) => {
        if (binding.sheetId !== removed.sheetId || binding.sourceId !== removed.sourceId) return false;
        try {
          const coordinate = parseA1(binding.cell);
          return coordinate.row === removed.templateRow && coordinate.column >= removed.startColumn && coordinate.column <= removed.endColumn;
        } catch { return false; }
      });
      bindingsToRemove.forEach((binding) => clearBindingPlaceholder(instanceRef.current?.api, binding));
      const removedBindingIds = new Set(bindingsToRemove.map((binding) => binding.id));
      setDefinition((current) => ({
        ...current,
        regions: current.regions.filter((region) => region.id !== removed.id),
        bindings: current.bindings.filter((binding) => !removedBindingIds.has(binding.id)),
      }));
      setNotice(`已移除重复区域 ${removed.id}，并清除区域内的绑定。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '移除重复区域失败。'); }
  }

  if (!ready && templateId) return <div className="page-wrap"><LoadingBlock label="正在读取报表模板…" /></div>;
  return <div className="page-wrap report-studio-page">
    <PageHeader eyebrow="REPORT STUDIO / WORKBOOK DESIGN" title="报表工作室" subtitle="使用电子表格方式设计项目级或公司级综合报表。绑定字段、设置明细自动延伸区域，然后预览实际业务数据并导出 XLSX。" actions={<><Button variant="secondary" onClick={() => navigate('/reports')}><ArrowLeft size={15}/>返回报表中心</Button><Button variant="secondary" onClick={() => void saveTemplate()} disabled={busy || !ready}><Save size={15}/>{busy ? '保存中…' : '保存模板'}</Button><Button variant="secondary" onClick={() => void publishTemplate()} disabled={busy || !ready}><Send size={15}/>发布</Button><Button onClick={() => void preview()} disabled={busy || !ready}><Eye size={15}/>预览并导出</Button></>} />
    {error && <div className="form-alert">{error}</div>}{notice && <div className="success-notice">{notice}</div>}{editorError && <ErrorBlock message={editorError} retry={() => { setReady(false); window.setTimeout(() => setReady(true), 0); }} />}
    <section className="panel report-studio-config">
      <label><span>报表级别</span><SelectField value={domain} onChange={(event) => changeDomain(event.currentTarget.value as ReportStudioDomain)} aria-label="报表级别"><option value="PROJECT">项目级综合报表</option><option value="COMPANY">公司级经营报表</option><option value="PARTY">往来单位经营档案报表</option></SelectField></label>
      {domain === 'PARTY' && <div className="report-studio-context-note"><strong>往来单位范围已锁定</strong><small>来自单位经营档案页面；所有关联项目、合同和财务明细仍按当前账号权限过滤。</small></div>}
      {domain === 'PROJECT' && <label><span>项目范围</span><SelectField value={projectId} onChange={(event) => { setProjectId(event.currentTarget.value); setTemplateId(''); }} aria-label="报表项目">{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</SelectField></label>}
      <label><span>现有模板</span><SelectField value={templateId} onChange={(event) => setTemplateId(event.currentTarget.value)} aria-label="已有报表模板"><option value="">新建默认模板</option>{(templatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version} · {template.scope === 'PROJECT' ? '项目共享' : template.scope === 'SYSTEM' ? '系统' : '个人'}</option>)}</SelectField></label>
      <label><span>模板名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={100} /></label>
      <label><span>模板说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={300} /></label>
      <label><span>模板共享范围</span><SelectField value={templateScope} onChange={(event) => setTemplateScope(event.target.value as typeof templateScope)} aria-label="模板共享范围"><option value="PERSONAL">个人模板</option>{domain === 'PROJECT' && <option value="PROJECT">项目共享模板</option>}{currentUser?.role === 'ADMIN' && <option value="SYSTEM">系统模板（管理员）</option>}</SelectField></label>
      <label><span>纸张</span><SelectField value={definition.page.paper} onChange={(event) => setDefinition((current) => ({ ...current, page: { ...current.page, paper: event.target.value as ReportStudioDefinition['page']['paper'] } }))} aria-label="纸张设置"><option value="A4">A4</option><option value="A3">A3</option><option value="Letter">Letter</option></SelectField></label>
      <label><span>方向</span><SelectField value={definition.page.orientation} onChange={(event) => setDefinition((current) => ({ ...current, page: { ...current.page, orientation: event.target.value as ReportStudioDefinition['page']['orientation'] } }))} aria-label="页面方向"><option value="landscape">横向</option><option value="portrait">纵向</option></SelectField></label>
    </section>
    <section className="report-studio-workspace">
      <aside className="panel report-studio-binding-panel">
        <div className="report-studio-panel-head"><span><Link2 size={16}/></span><div><strong>数据绑定与重复区域</strong><small>先在表格中选择单元格，再读取选区绑定</small></div></div>
        <div className="report-studio-panel-body">
          <div className="report-studio-current-selection"><span>工作表 / 单元格</span><div className="report-studio-selection-row"><input value={selectedCell} onChange={(event) => setSelectedCell(event.target.value.toUpperCase())} aria-label="绑定单元格地址"/><Button variant="secondary" size="sm" onClick={readActiveSelection}>读取选区</Button></div><small>当前区域：{selectedRange} · 工作表：{selectedSheetId}</small></div>
          <label className="report-studio-control"><span>数据源</span><SelectField value={sourceId} onChange={(event) => { const next = event.currentTarget.value; setSourceId(next); setFieldId(sources.find((source) => source.id === next)?.fields[0]?.id ?? ''); }} aria-label="数据绑定源">{sourceOptions.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</SelectField></label>
          <label className="report-studio-control"><span>字段</span><SelectField value={fieldId} onChange={(event) => setFieldId(event.currentTarget.value)} aria-label="数据绑定字段">{fieldOptions.map((field) => <option key={field.id} value={field.id}>{field.label} · {field.type}</option>)}</SelectField></label>
          {selectedSource && <p className="report-studio-source-help">{selectedSource.description}</p>}
          <div className="report-studio-action-stack"><Button onClick={addBinding} disabled={!ready || !selectedField}><Link2 size={14}/>绑定到单元格</Button><Button variant="secondary" onClick={removeBinding}><Trash2 size={14}/>移除当前单元格绑定</Button></div>
          <hr/>
          <strong className="report-studio-subhead">集合明细自动延伸</strong>
          <p className="report-studio-source-help">选中一整行样板区域，例如 A10:F10，选择“明细集合”数据源，再点击创建。该行绑定字段会随每条记录复制；后续区域会自动下移。</p>
          <div className="report-studio-action-stack"><Button onClick={addRegion} disabled={selectedSource?.cardinality !== 'MANY'}><Grid2X2Plus size={14}/>设置为自动延伸区域</Button><Button variant="secondary" onClick={removeSelectedRegion}><Trash2 size={14}/>移除当前行重复区域</Button></div>
          <hr/>
          <strong className="report-studio-subhead">当前模板结构</strong>
          <div className="report-studio-structure-list"><span>单元格绑定 <b>{definition.bindings.length}</b></span><span>明细重复区域 <b>{definition.regions.length}</b></span><span>工作表 <b>{Array.isArray(definition.workbook.sheetOrder) ? definition.workbook.sheetOrder.length : 1}</b></span></div>
          <div className="report-studio-region-list">{definition.regions.map((region) => <div key={region.id}><strong>{sources.find((item) => item.id === region.sourceId)?.label ?? region.sourceId}</strong><small>{region.sheetId} · 第 {region.templateRow + 1} 行 · {region.startColumn + 1}–{region.endColumn + 1} 列</small></div>)}</div>
          <p className="report-studio-source-help">提示：第一阶段使用受控字段白名单，模板不能执行任意 SQL/脚本。样板行只支持单行区域；不同区域可以有不同数据源与字段集合。</p>
        </div>
      </aside>
      <section className="panel report-studio-editor-panel">
        <div className="report-studio-panel-head"><span><FileSpreadsheet size={16}/></span><div><strong>工作簿编辑器</strong><small>支持常见字体、字号、颜色、填充、边框、对齐、合并、行高列宽和多工作表操作</small></div><div className="report-studio-sheet-meta"><LoaderCircle size={14} className={busy ? 'is-spinning' : ''}/>{ready && !editorError ? '工作簿已加载' : '正在初始化'}</div></div>
        {!ready ? <LoadingBlock label="准备工作簿和数据绑定…"/> : <div className="report-studio-editor-host" ref={hostRef} />}
      </section>
    </section>
    <div className="report-studio-footer-note"><span>导出的报表只读，不会回写业务台账。项目级按指定项目生成，公司级只汇总当前账号有权访问的项目。金额口径由业务数据源负责，模板只决定取值位置与展示格式。</span></div>
  </div>;
}
