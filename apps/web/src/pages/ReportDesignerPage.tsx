import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowDown, ArrowUp, ArrowDownToLine, Check, ChevronDown, Columns3, Copy, FileSpreadsheet, History,
  Merge, Plus, Printer, RotateCcw, Rows3, Save, Scissors, Settings2, ShieldCheck,
  TableProperties, Trash2, WandSparkles, X,
} from 'lucide-react';
import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import { Button, ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';
import type { Project } from '../types';
import type {
  ReportCatalogEntry, ReportField, ReportPreview, ReportTemplateColumn, ReportTemplateDefinition,
  ReportTemplateDetail, ReportTemplateRow, ReportTemplateScope, ReportTemplateSummary, TemplateRevision,
} from '../report-template-types';

const reportFallback: Omit<ReportCatalogEntry, 'fields'>[] = [
  { key: 'target-cost', label: '目标成本清单', description: '项目清单编号、父级、工程量、单价、目标合价与最近更新时间。', dateField: '更新时间', rowLimit: 10000 },
  { key: 'actual-cost', label: '实际成本台账', description: '成本发生日期、分类、金额、业务对象、合同及清单关联。', dateField: '成本日期', rowLimit: 10000 },
  { key: 'progress-bills', label: '业主进度款申报', description: '申报、核定、到账汇总与主合同关联。', dateField: '申报日期', rowLimit: 10000 },
  { key: 'changes', label: '变更签证台账', description: '送审金额、内部审批、外部确认状态与实际生效金额。', dateField: '发生日期', rowLimit: 10000 },
  { key: 'owner-receivables', label: '业主应收台账', description: '毛额、扣款、净应收、到期日与当前状态。', dateField: '入账日期', rowLimit: 10000 },
  { key: 'owner-receipts', label: '业主到账与退款流水', description: '到账和退款独立记录，保留类型与原始流水关联。', dateField: '到账日期', rowLimit: 10000 },
  { key: 'downstream-contracts', label: '分供合同台账', description: '原始合同额、有效调整汇总、状态与往来单位。', dateField: '创建日期', rowLimit: 10000 },
  { key: 'downstream-payables', label: '分供应付台账', description: '已过账应付、扣款、净应付、到期日与关联合同。', dateField: '入账日期', rowLimit: 10000 },
];

type DesignerTab = 'columns' | 'layout' | 'page';
type CellSelection = { anchorRow: number; anchorCol: number; endRow: number; endCol: number };
type MergeRegion = ReportTemplateDefinition['merges'][number];

function defaultDefinition(report: Omit<ReportCatalogEntry, 'fields'> | ReportCatalogEntry, fields: ReportField[]): ReportTemplateDefinition {
  return {
    schemaVersion: 1,
    title: report.label,
    subtitle: '项目：{project}　生成时间：{generatedAt}',
    columns: fields.map((field) => ({
      id: field.key, fieldKey: field.key, label: field.label, width: field.defaultWidth, visible: true,
      align: field.type === 'money' || field.type === 'number' ? 'right' : field.type === 'date' ? 'center' : 'left',
      format: field.type === 'money' ? 'money' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'auto', staticValue: '',
    })),
    customRows: [], merges: [],
    rowHeights: { title: 32, subtitle: 22, header: 28, body: 22 },
    page: { paper: 'A4', orientation: 'landscape', fitToWidth: true, repeatHeader: true, includeDescription: true, footerText: '墨衡工程经营管理系统', showPageNumber: true },
  };
}

function getVisibleIndexes(definition: ReportTemplateDefinition): number[] {
  return definition.columns.map((column, index) => column.visible ? index : -1).filter((index) => index >= 0);
}

function mergedRegionAt(merges: MergeRegion[], row: number, col: number): MergeRegion | undefined {
  return merges.find((merge) => row >= merge.row && row < merge.row + merge.rowSpan && col >= merge.col && col < merge.col + merge.colSpan);
}

function adjustMergeRows(merges: MergeRegion[], action: 'insert' | 'delete', index: number): MergeRegion[] {
  return merges.flatMap((merge) => {
    if (action === 'insert') {
      if (merge.row >= index) return [{ ...merge, row: merge.row + 1 }];
      if (merge.row < index && merge.row + merge.rowSpan > index) return [{ ...merge, rowSpan: merge.rowSpan + 1 }];
      return [merge];
    }
    if (index < merge.row) return [{ ...merge, row: merge.row - 1 }];
    if (index >= merge.row && index < merge.row + merge.rowSpan) {
      if (merge.rowSpan === 1) return [];
      return [{ ...merge, row: merge.row === index ? merge.row : merge.row, rowSpan: merge.rowSpan - 1 }];
    }
    return [merge];
  }).filter((merge) => merge.row >= 0 && merge.rowSpan > 0);
}

function adjustMergeColumns(merges: MergeRegion[], action: 'insert' | 'delete', index: number): MergeRegion[] {
  return merges.flatMap((merge) => {
    if (action === 'insert') {
      if (merge.col >= index) return [{ ...merge, col: merge.col + 1 }];
      if (merge.col < index && merge.col + merge.colSpan > index) return [{ ...merge, colSpan: merge.colSpan + 1 }];
      return [merge];
    }
    if (index < merge.col) return [{ ...merge, col: merge.col - 1 }];
    if (index >= merge.col && index < merge.col + merge.colSpan) {
      if (merge.colSpan === 1) return [];
      return [{ ...merge, col: merge.col === index ? merge.col : merge.col, colSpan: merge.colSpan - 1 }];
    }
    return [merge];
  }).filter((merge) => merge.col >= 0 && merge.colSpan > 0);
}

function remapVisibleMerges(definition: ReportTemplateDefinition, visibleIndexes: number[]): Array<MergeRegion & { anchorSourceCol: number }> {
  return definition.merges.flatMap((merge) => {
    if (merge.row >= definition.customRows.length || merge.row + merge.rowSpan > definition.customRows.length) return [];
    const included = visibleIndexes.filter((sourceCol) => sourceCol >= merge.col && sourceCol < merge.col + merge.colSpan);
    if (included.length === 0) return [];
    const mappedCol = visibleIndexes.indexOf(included[0]!);
    if (mappedCol < 0) return [];
    return [{ ...merge, col: mappedCol, colSpan: included.length, anchorSourceCol: included[0]! }];
  });
}

function formatPreviewValue(value: unknown, column: ReportTemplateColumn, fields: ReportField[]): string {
  if (value == null || value === '') return '—';
  const index = column.fieldKey ? fields.findIndex((field) => field.key === column.fieldKey) : -1;
  const type = column.format === 'auto' ? (index >= 0 ? fields[index]!.type : 'text') : column.format;
  if (type === 'date') {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'UTC' }).format(date);
  }
  if (type === 'money' || type === 'number') {
    const number = Number(value);
    if (Number.isFinite(number)) return number.toLocaleString('zh-CN', { minimumFractionDigits: type === 'money' ? 2 : 0, maximumFractionDigits: type === 'money' ? 2 : 3 });
  }
  return String(value);
}

function expandedSubtitle(subtitle: string, project: string, generatedAt: string, rowCount: number): string {
  return subtitle.replaceAll('{project}', project).replaceAll('{generatedAt}', new Date(generatedAt).toLocaleString('zh-CN')).replaceAll('{rowCount}', String(rowCount));
}

export default function ReportDesignerPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((state) => state.user);
  const selectedProjectId = useUiStore((state) => state.selectedProjectId);
  const [reportKey, setReportKey] = useState(searchParams.get('reportKey') ?? 'target-cost');
  const [filterProjectId, setFilterProjectId] = useState(searchParams.get('projectId') ?? selectedProjectId ?? '');
  const [templateId, setTemplateId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [templateDescription, setTemplateDescription] = useState('');
  const [templateScope, setTemplateScope] = useState<ReportTemplateScope>('PERSONAL');
  const [createScope, setCreateScope] = useState<ReportTemplateScope>('PERSONAL');
  const [templateVersion, setTemplateVersion] = useState(1);
  const [templateEditable, setTemplateEditable] = useState(false);
  const [definition, setDefinition] = useState<ReportTemplateDefinition | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<DesignerTab>('columns');
  const [selection, setSelection] = useState<CellSelection | null>(null);
  const [selectedColumn, setSelectedColumn] = useState(0);
  const [selectedRow, setSelectedRow] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(searchParams.get('from') ?? '');
  const [to, setTo] = useState(searchParams.get('to') ?? '');
  const [addFieldKey, setAddFieldKey] = useState('');
  const [printRows, setPrintRows] = useState<unknown[][] | null>(null);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const catalogQuery = useQuery({ queryKey: ['reports-catalog-designer'], queryFn: () => api.get<ReportCatalogEntry[]>('/reports/catalog') });
  const catalog = catalogQuery.data ?? [];
  const currentReport = catalog.find((report) => report.key === reportKey) ?? catalog.find((report) => report.key === reportFallback[0]!.key);
  const fields = currentReport?.fields ?? [];
  const templatesQuery = useQuery({
    queryKey: ['report-templates', reportKey, filterProjectId],
    queryFn: () => api.get<ReportTemplateSummary[]>(`/reports/templates?reportKey=${encodeURIComponent(reportKey)}${filterProjectId ? `&projectId=${encodeURIComponent(filterProjectId)}` : ''}`),
  });
  const previewQuery = useQuery({
    queryKey: ['report-designer-preview', reportKey, filterProjectId, from, to],
    queryFn: () => {
      const params = new URLSearchParams();
      if (filterProjectId) params.set('projectId', filterProjectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      return api.get<ReportPreview>(`/reports/${reportKey}/preview?${params.toString()}`);
    }, enabled: Boolean(currentReport) && !(from && to && from > to),
  });
  const revisionsQuery = useQuery({
    queryKey: ['report-template-revisions', templateId],
    queryFn: () => api.get<TemplateRevision[]>(`/reports/templates/${templateId}/revisions`),
    enabled: Boolean(templateId),
  });
  const model = definition ?? (currentReport ? defaultDefinition(currentReport, fields) : defaultDefinition(reportFallback[0]!, []));
  const visibleIndexes = useMemo(() => getVisibleIndexes(model), [model]);
  const usedFieldKeys = useMemo(() => new Set(model.columns.map((column) => column.fieldKey).filter(Boolean)), [model.columns]);
  const availableFields = fields.filter((field) => !usedFieldKeys.has(field.key));
  const canCreateSystem = currentUser?.role === 'ADMIN';

  useEffect(() => {
    const routeReportKey = searchParams.get('reportKey');
    if (routeReportKey && routeReportKey !== reportKey) setReportKey(routeReportKey);
    const routeProjectId = searchParams.get('projectId');
    if (routeProjectId !== null && routeProjectId !== filterProjectId) setFilterProjectId(routeProjectId);
    const routeFrom = searchParams.get('from');
    if (routeFrom !== null && routeFrom !== from) setFrom(routeFrom);
    const routeTo = searchParams.get('to');
    if (routeTo !== null && routeTo !== to) setTo(routeTo);
  }, [searchParams]);

  useEffect(() => {
    if (!currentReport) return;
    setTemplateId(''); setTemplateName(`${currentReport.label} - 自定义版式`); setTemplateDescription(''); setTemplateScope('PERSONAL'); setCreateScope('PERSONAL');
    setTemplateVersion(1); setTemplateEditable(false); setDefinition(defaultDefinition(currentReport, currentReport.fields)); setDirty(false); setSelection(null); setSelectedColumn(0); setSelectedRow(0);
  // The definition is intentionally reset only when the report data schema changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportKey, catalogQuery.data]);

  function updateDefinition(updater: (current: ReportTemplateDefinition) => ReportTemplateDefinition) {
    setDefinition((current) => updater(current ?? defaultDefinition(currentReport ?? reportFallback[0]!, fields)));
    setDirty(true); setNotice('');
  }

  async function chooseTemplate(id: string) {
    setError(''); setNotice(''); setSelection(null);
    if (!id) {
      setTemplateId(''); setTemplateName(`${currentReport?.label ?? '业务报表'} - 自定义版式`); setTemplateDescription(''); setTemplateScope('PERSONAL');
      setCreateScope('PERSONAL'); setTemplateVersion(1); setTemplateEditable(false); setDefinition(defaultDefinition(currentReport ?? reportFallback[0]!, fields)); setDirty(false); return;
    }
    setBusy(true);
    try {
      const loaded = await api.get<ReportTemplateDetail>(`/reports/templates/${id}`);
      setTemplateId(loaded.id); setTemplateName(loaded.name); setTemplateDescription(loaded.description); setTemplateScope(loaded.scope);
      setCreateScope(loaded.editable ? loaded.scope : 'PERSONAL'); setTemplateVersion(loaded.version); setTemplateEditable(loaded.editable);
      setDefinition(loaded.definition); setDirty(false); setNotice(`已加载“${loaded.name}”第 ${loaded.version} 版。`);
      setSelectedColumn(0); setSelectedRow(0);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '模板加载失败'); }
    finally { setBusy(false); }
  }

  async function persistTemplate(forceCopy = false): Promise<{ id: string; version: number }> {
    if (!currentReport) throw new Error('报表类型尚未加载');
    setBusy(true); setError(''); setNotice('');
    try {
      const shouldUpdate = Boolean(templateId && templateEditable && !forceCopy && createScope === templateScope);
      let result: ReportTemplateDetail;
      if (shouldUpdate) {
        result = await api.patch<ReportTemplateDetail>(`/reports/templates/${templateId}`, {
          name: templateName, description: templateDescription, expectedVersion: templateVersion, definition: model,
        });
      } else {
        const scope = forceCopy ? 'PERSONAL' : createScope;
        const newName = forceCopy && templateId && !templateName.includes('副本') ? `${templateName} - 我的副本` : templateName;
        result = await api.post<ReportTemplateDetail>('/reports/templates', {
          reportKey, name: newName, description: templateDescription, scope,
          projectId: scope === 'PROJECT' ? filterProjectId : null, definition: model,
        });
        setTemplateName(result.name); setTemplateScope(result.scope); setCreateScope(result.scope);
      }
      setTemplateId(result.id); setTemplateVersion(result.version); setTemplateEditable(true); setTemplateScope(result.scope); setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ['report-templates', reportKey] });
      await templatesQuery.refetch().catch(() => undefined);
      setNotice(`已保存“${result.name}”第 ${result.version} 版草稿。`);
      return { id: result.id, version: result.version };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '模板保存失败';
      setError(message); throw new Error(message);
    } finally { setBusy(false); }
  }

  async function saveTemplate(forceCopy = false) {
    try { await persistTemplate(forceCopy); } catch { /* visible error is set in persistTemplate */ }
  }

  async function publishTemplate() {
    try {
      let id = templateId;
      if (!id || dirty || !templateEditable) id = (await persistTemplate()).id;
      setBusy(true); setError('');
      const published = await api.post<ReportTemplateDetail>(`/reports/templates/${id}/publish`, {});
      setTemplateId(published.id); setTemplateVersion(published.version); setTemplateEditable(true); setTemplateScope(published.scope); setDirty(false);
      await queryClient.invalidateQueries({ queryKey: ['report-templates', reportKey] });
      setNotice(`已发布“${published.name}”，当前发布版本为 ${published.publishedVersion ?? published.version}。`);
    } catch (cause) { if (!(cause instanceof Error && error)) setError(cause instanceof Error ? cause.message : '发布失败'); }
    finally { setBusy(false); }
  }

  async function restoreRevision(revisionId: string) {
    if (!templateId) return;
    setBusy(true); setError('');
    try {
      const restored = await api.post<ReportTemplateDetail>(`/reports/templates/${templateId}/revisions/${revisionId}/restore`, { expectedVersion: templateVersion });
      setDefinition(restored.definition); setTemplateVersion(restored.version); setDirty(false); setTemplateEditable(true);
      setNotice(`已恢复历史版本内容，生成新草稿版本 ${restored.version}；发布前不会改变当前已发布版式。`);
      await queryClient.invalidateQueries({ queryKey: ['report-template-revisions', templateId] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : '恢复失败'); }
    finally { setBusy(false); }
  }


  async function archiveTemplate() {
    if (!templateId || !templateEditable || dirty) return;
    if (!window.confirm(`确定归档模板“${templateName}”吗？归档后它不会再出现在模板列表中，历史版本和审计记录会保留。`)) return;
    setBusy(true); setError('');
    try {
      await api.post<ReportTemplateDetail>(`/reports/templates/${templateId}/archive`, { expectedVersion: templateVersion });
      await queryClient.invalidateQueries({ queryKey: ['report-templates', reportKey] });
      setTemplateId(''); setTemplateName(`${currentReport?.label ?? '业务报表'} - 自定义版式`); setTemplateDescription('');
      setTemplateScope('PERSONAL'); setCreateScope('PERSONAL'); setTemplateVersion(1); setTemplateEditable(false);
      setDefinition(defaultDefinition(currentReport ?? reportFallback[0]!, fields)); setDirty(false);
      setNotice('模板已归档；历史版本与审计记录已保留。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '归档失败'); }
    finally { setBusy(false); }
  }

  async function outputPrint() {
    setBusy(true); setError(''); setNotice('');
    try {
      const params = new URLSearchParams();
      if (filterProjectId) params.set('projectId', filterProjectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      params.set('printAll', 'true');
      const result = await api.get<ReportPreview>(`/reports/${reportKey}/preview?${params.toString()}`);
      setPrintRows(result.rows as unknown[][]);
      setNotice(`已准备 ${result.previewRowCount.toLocaleString('zh-CN')} 行完整打印数据；如果数据被导出上限截断，页内会显示提醒。`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '打印数据加载失败'); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (printRows === null) return;
    const afterPrint = () => setPrintRows(null);
    window.addEventListener('afterprint', afterPrint);
    const timeout = window.setTimeout(() => window.print(), 300);
    return () => { window.clearTimeout(timeout); window.removeEventListener('afterprint', afterPrint); };
  }, [printRows]);

  async function outputXlsx() {
    try {
      let id = templateId;
      if (dirty) id = (await persistTemplate()).id;
      setBusy(true); setError('');
      const params = new URLSearchParams();
      if (filterProjectId) params.set('projectId', filterProjectId);
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (id) params.set('templateId', id);
      const blob = await api.download(`/reports/${reportKey}.xlsx?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `墨衡-${currentReport?.label ?? reportKey}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      setNotice('原生 XLSX 工作簿已开始下载；修改工作簿不会回写墨衡业务台账。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'XLSX 导出失败'); }
    finally { setBusy(false); }
  }

  function updateColumn(index: number, patch: Partial<ReportTemplateColumn>) {
    updateDefinition((current) => ({ ...current, columns: current.columns.map((column, i) => i === index ? { ...column, ...patch } : column) }));
  }

  function moveColumn(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= model.columns.length) return;
    const touchesMergedArea = model.merges.some((merge) => index >= merge.col && index < merge.col + merge.colSpan || target >= merge.col && target < merge.col + merge.colSpan);
    if (touchesMergedArea) { setError('请先拆分涉及该列的合并单元格，再调整列顺序。'); return; }
    updateDefinition((current) => {
      const columns = [...current.columns]; [columns[index], columns[target]] = [columns[target]!, columns[index]!];
      return { ...current, columns, customRows: current.customRows.map((row) => { const cells = [...row.cells]; [cells[index], cells[target]] = [cells[target]!, cells[index]!]; return { ...row, cells }; }) };
    });
    setSelectedColumn(target);
  }

  function addBoundColumn() {
    const field = fields.find((item) => item.key === addFieldKey);
    if (!field) return;
    if (model.columns.length >= 40) { setError('最多支持 40 列。'); return; }
    updateDefinition((current) => ({ ...current,
      columns: [...current.columns, { id: field.key, fieldKey: field.key, label: field.label, width: field.defaultWidth, visible: true,
        align: field.type === 'money' || field.type === 'number' ? 'right' : field.type === 'date' ? 'center' : 'left',
        format: field.type === 'money' ? 'money' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'auto', staticValue: '' }],
      customRows: current.customRows.map((row) => ({ ...row, cells: [...row.cells, ''] })),
    }));
    setSelectedColumn(model.columns.length); setAddFieldKey('');
  }

  function addStaticColumn() {
    if (model.columns.length >= 40) { setError('最多支持 40 列。'); return; }
    const id = `static-${crypto.randomUUID()}`;
    updateDefinition((current) => ({ ...current,
      columns: [...current.columns, { id, fieldKey: null, label: '自定义列', width: 16, visible: true, align: 'left', format: 'text', staticValue: '' }],
      customRows: current.customRows.map((row) => ({ ...row, cells: [...row.cells, ''] })),
    }));
    setSelectedColumn(model.columns.length);
  }

  function removeColumn(index: number) {
    if (model.columns.length <= 1) { setError('报表至少要保留一列。'); return; }
    updateDefinition((current) => ({ ...current,
      columns: current.columns.filter((_, i) => i !== index),
      customRows: current.customRows.map((row) => ({ ...row, cells: row.cells.filter((_, i) => i !== index) })),
      merges: adjustMergeColumns(current.merges, 'delete', index),
    }));
    setSelectedColumn(Math.max(0, Math.min(index, model.columns.length - 2))); setSelection(null);
  }

  function addCustomRow(index = model.customRows.length) {
    if (model.customRows.length >= 12) { setError('自定义版式行最多 12 行。'); return; }
    const row: ReportTemplateRow = { id: `row-${crypto.randomUUID()}`, height: 24, cells: model.columns.map(() => '') };
    updateDefinition((current) => ({ ...current, customRows: [...current.customRows.slice(0, index), row, ...current.customRows.slice(index)], merges: adjustMergeRows(current.merges, 'insert', index) }));
    setSelectedRow(index); setSelection(null);
  }

  function removeCustomRow(index: number) {
    updateDefinition((current) => ({ ...current, customRows: current.customRows.filter((_, i) => i !== index), merges: adjustMergeRows(current.merges, 'delete', index) }));
    setSelectedRow(Math.max(0, Math.min(index, model.customRows.length - 2))); setSelection(null);
  }

  function updateCell(row: number, col: number, value: string) {
    updateDefinition((current) => ({ ...current, customRows: current.customRows.map((item, index) => index === row ? { ...item, cells: item.cells.map((cell, cellIndex) => cellIndex === col ? value : cell) } : item) }));
  }

  function mergeSelected() {
    if (!selection) { setError('先点击一个单元格，再按住 Shift 点击另一个单元格选择合并区域。'); return; }
    const row = Math.min(selection.anchorRow, selection.endRow); const col = Math.min(selection.anchorCol, selection.endCol);
    const rowSpan = Math.abs(selection.endRow - selection.anchorRow) + 1; const colSpan = Math.abs(selection.endCol - selection.anchorCol) + 1;
    if (rowSpan === 1 && colSpan === 1) { setError('请至少选择两个单元格再合并。'); return; }
    const candidate = { row, col, rowSpan, colSpan };
    const intersects = model.merges.some((merge) => row < merge.row + merge.rowSpan && row + rowSpan > merge.row && col < merge.col + merge.colSpan && col + colSpan > merge.col);
    if (intersects) { setError('选择区域与已有合并区域重叠，请先拆分旧区域。'); return; }
    updateDefinition((current) => ({ ...current, merges: [...current.merges, candidate] })); setError('');
  }

  function splitSelected() {
    if (!selection) { setError('先选择需要拆分的单元格区域。'); return; }
    const row = Math.min(selection.anchorRow, selection.endRow); const col = Math.min(selection.anchorCol, selection.endCol);
    const rowEnd = Math.max(selection.anchorRow, selection.endRow) + 1; const colEnd = Math.max(selection.anchorCol, selection.endCol) + 1;
    const matches = (merge: MergeRegion) => row < merge.row + merge.rowSpan && rowEnd > merge.row && col < merge.col + merge.colSpan && colEnd > merge.col;
    if (!model.merges.some(matches)) { setError('选区内没有可拆分的合并单元格。'); return; }
    updateDefinition((current) => ({ ...current, merges: current.merges.filter((merge) => !matches(merge)) })); setError('');
  }

  if (catalogQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在加载报表模板工具…" /></div>;
  if (catalogQuery.error) return <div className="page-wrap"><ErrorBlock message={String(catalogQuery.error)} retry={() => void catalogQuery.refetch()} /></div>;
  if (!currentReport) return <div className="page-wrap"><ErrorBlock message="当前报表类型不存在。" retry={() => navigate('/reports')} /></div>;

  const outputColumns = model.columns.filter((column) => column.visible);
  const preview = previewQuery.data;
  const mappedMerges = remapVisibleMerges(model, visibleIndexes);
  const selectedMergeArea = selection ? {
    row: Math.min(selection.anchorRow, selection.endRow), col: Math.min(selection.anchorCol, selection.endCol),
    rowSpan: Math.abs(selection.endRow - selection.anchorRow) + 1, colSpan: Math.abs(selection.endCol - selection.anchorCol) + 1,
  } : null;

  return <div className="page-wrap report-designer-page"><style>{`@media print { @page { size: ${model.page.paper} ${model.page.orientation}; margin: 10mm; } }`}</style>
    <PageHeader eyebrow="REPORTS / TEMPLATE STUDIO" title="报表设计器" subtitle="设计可复用的报表版式；数据仍由墨衡按当前账号与项目权限生成，模板修改不会写入业务台账。" actions={<><Button variant="secondary" onClick={() => navigate('/reports')}><X size={15} />返回报表中心</Button><Button variant="secondary" onClick={() => void outputXlsx()} disabled={busy || Boolean(from && to && from > to)}><FileSpreadsheet size={15} />导出 XLSX</Button><Button onClick={() => void outputPrint()} disabled={!preview || busy || Boolean(from && to && from > to)}><Printer size={15} />完整报表 / 打印 PDF</Button></>} />
    <section className="report-designer-topbar panel">
      <label className="report-designer-compact-field"><span>报表类型</span><select value={reportKey} onChange={(event) => setReportKey(event.target.value)}>{catalog.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <label className="report-designer-compact-field"><span>选择模板</span><select value={templateId} onChange={(event) => void chooseTemplate(event.target.value)}><option value="">系统默认版式（只读基线）</option>{(templatesQuery.data ?? []).map((template) => <option key={template.id} value={template.id}>{template.scope === 'SYSTEM' ? '系统' : template.scope === 'PROJECT' ? '项目' : '个人'} · {template.name} · v{template.version}{template.status === 'DRAFT' || template.publishedVersion !== template.version ? '（含未发布修改）' : ''}</option>)}</select></label>
      <label className="report-designer-compact-field"><span>模板名称</span><input value={templateName} maxLength={100} onChange={(event) => { setTemplateName(event.target.value); setDirty(true); }} /></label>
      <div className="report-designer-save-actions"><Button variant="secondary" onClick={() => void saveTemplate(true)} disabled={busy}><Copy size={14} />另存为个人模板</Button><Button onClick={() => void saveTemplate()} disabled={busy || !templateName.trim()}><Save size={14} />{busy ? '处理中…' : '保存草稿'}</Button><Button variant="secondary" onClick={() => void publishTemplate()} disabled={busy || !(templateId || createScope)}><Check size={14} />发布版本</Button>{templateId && templateEditable && <Button variant="ghost" onClick={() => void archiveTemplate()} disabled={busy || dirty}><Trash2 size={14} />归档模板</Button>}</div>
    </section>
    <div className="report-designer-filterbar panel">
      <div className="report-designer-filter-note"><ShieldCheck size={16} /><span>预览数据范围：{filterProjectId ? '所选项目' : '全部有权限项目'}；预览最多显示 80 行，导出按现有 10,000 行上限执行。</span></div>
      <label><span>项目范围</span><select value={filterProjectId} onChange={(event) => setFilterProjectId(event.target.value)}><option value="">全部可访问项目</option>{(projectsQuery.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name} · {project.code}</option>)}</select></label>
      <label><span>开始日期</span><input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
      <label><span>结束日期</span><input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
      <Button variant="secondary" onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>清除日期</Button>
      <Button variant="ghost" onClick={() => void previewQuery.refetch()} disabled={previewQuery.isFetching}><RotateCcw size={14} />刷新预览</Button>
    </div>

    {(error || notice) && <div className={error ? 'report-designer-message is-error' : 'report-designer-message is-success'}>{error || notice}<button type="button" aria-label="关闭提示" onClick={() => { setError(''); setNotice(''); }}><X size={14} /></button></div>}

    <div className="report-designer-workspace">
      <aside className="report-designer-panel panel">
        <div className="report-designer-panel-head"><div><span className="eyebrow">TEMPLATE LAYOUT</span><h2>模板属性</h2></div><span className={dirty ? 'report-dirty-indicator is-dirty' : 'report-dirty-indicator'}>{dirty ? '未保存' : `v${templateVersion}`}</span></div>
        <div className="report-designer-tabs" role="tablist">
          <button type="button" className={tab === 'columns' ? 'is-active' : ''} onClick={() => setTab('columns')}><Columns3 size={15} />字段</button>
          <button type="button" className={tab === 'layout' ? 'is-active' : ''} onClick={() => setTab('layout')}><Rows3 size={15} />版式</button>
          <button type="button" className={tab === 'page' ? 'is-active' : ''} onClick={() => setTab('page')}><Settings2 size={15} />页面</button>
        </div>
        {tab === 'columns' && <div className="report-designer-props">
          <label className="report-designer-prop"><span>导出主标题</span><input value={model.title} maxLength={120} onChange={(event) => updateDefinition((current) => ({ ...current, title: event.target.value }))} /></label>
          <label className="report-designer-prop"><span>副标题 / 上下文</span><input value={model.subtitle} maxLength={240} onChange={(event) => updateDefinition((current) => ({ ...current, subtitle: event.target.value }))} /><small>可用变量：{'{project}'}、{'{generatedAt}'}、{'{rowCount}'}</small></label>
          <label className="report-designer-prop"><span>模板说明</span><textarea value={templateDescription} maxLength={240} rows={2} onChange={(event) => { setTemplateDescription(event.target.value); setDirty(true); }} /></label>
          <div className="report-designer-list-head"><strong>输出列与数据字段</strong><span>{outputColumns.length}/{model.columns.length} 列显示</span></div>
          <div className="report-column-editor-list">
            {model.columns.map((column, index) => {
              const source = fields.find((field) => field.key === column.fieldKey);
              return <div className={`report-column-editor ${selectedColumn === index ? 'is-selected' : ''}`} key={column.id} onClick={() => setSelectedColumn(index)}>
                <div className="report-column-editor-top"><label className="report-visibility-toggle"><input type="checkbox" checked={column.visible} onChange={(event) => updateColumn(index, { visible: event.target.checked })} /><span>{index + 1}</span></label><input aria-label="列标题" value={column.label} maxLength={80} onChange={(event) => updateColumn(index, { label: event.target.value })} /><div className="report-column-order"><button type="button" title="上移" disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveColumn(index, -1); }}><ArrowUp size={13} /></button><button type="button" title="下移" disabled={index === model.columns.length - 1} onClick={(event) => { event.stopPropagation(); moveColumn(index, 1); }}><ArrowDown size={13} /></button></div></div>
                <div className="report-column-editor-fields">
                  <label><span>绑定字段</span><select value={column.fieldKey ?? ''} onChange={(event) => { const field = fields.find((item) => item.key === event.target.value); updateColumn(index, { fieldKey: field?.key ?? null, label: field ? field.label : column.label, format: field?.type === 'money' ? 'money' : field?.type === 'number' ? 'number' : field?.type === 'date' ? 'date' : field ? 'auto' : 'text', align: field?.type === 'money' || field?.type === 'number' ? 'right' : field?.type === 'date' ? 'center' : 'left' }); }}><option value="">自定义静态列</option>{fields.filter((field) => field.key === column.fieldKey || !usedFieldKeys.has(field.key)).map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select></label>
                  <label className="report-width-field"><span>列宽</span><input type="number" min={8} max={60} value={column.width} onChange={(event) => updateColumn(index, { width: Math.max(8, Math.min(60, Number(event.target.value) || 8)) })} /></label>
                  <label><span>对齐</span><select value={column.align} onChange={(event) => updateColumn(index, { align: event.target.value as ReportTemplateColumn['align'] })}><option value="left">左对齐</option><option value="center">居中</option><option value="right">右对齐</option></select></label>
                  <label><span>数据格式</span><select value={column.format} onChange={(event) => updateColumn(index, { format: event.target.value as ReportTemplateColumn['format'] })}><option value="auto">按字段自动</option><option value="text">文本</option><option value="number">数值</option><option value="money">金额</option><option value="date">日期</option></select></label>
                  {!source && <label className="report-static-value"><span>静态列值（每行重复）</span><input value={column.staticValue} maxLength={160} onChange={(event) => updateColumn(index, { staticValue: event.target.value })} /></label>}
                  <button type="button" className="report-column-delete" onClick={(event) => { event.stopPropagation(); removeColumn(index); }}><Trash2 size={13} />删除该列</button>
                </div>
              </div>;
            })}
          </div>
          <div className="report-add-column-actions">
            <div><select value={addFieldKey} onChange={(event) => setAddFieldKey(event.target.value)}><option value="">选择要增加的字段…</option>{availableFields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}</select><Button variant="secondary" onClick={addBoundColumn} disabled={!addFieldKey}><Plus size={13} />添加数据列</Button></div>
            <Button variant="secondary" onClick={addStaticColumn}><Plus size={13} />添加自定义列</Button>
          </div>
        </div>}

        {tab === 'layout' && <div className="report-designer-props">
          <p className="report-designer-help">版式区位于标题下方、数据表头上方。选中单元格后按住 Shift 点击另一个单元格，可框选矩形；合并只影响版式区，不改变数据。</p>
          <div className="report-layout-toolrow"><Button variant="secondary" onClick={() => addCustomRow(selection ? Math.min(selection.anchorRow, selection.endRow) : model.customRows.length)} disabled={model.customRows.length >= 12}><Plus size={13} />插入行</Button><Button variant="secondary" onClick={() => removeCustomRow(selectedRow)} disabled={!model.customRows.length}><Trash2 size={13} />删除选中行</Button></div>
          <div className="report-layout-toolrow"><Button variant="secondary" onClick={mergeSelected} disabled={!selection}><Merge size={13} />合并选区</Button><Button variant="secondary" onClick={splitSelected} disabled={!selection}><Scissors size={13} />拆分选区</Button></div>
          <div className="report-layout-grid-scroll"><table className="report-layout-grid"><thead><tr><th className="report-grid-rowhead">行</th>{model.columns.map((column, index) => <th key={column.id} className={column.visible ? '' : 'is-hidden-column'} onClick={() => setSelectedColumn(index)}><span>{index + 1}</span><small>{column.label}</small></th>)}</tr></thead><tbody>
            {model.customRows.map((row, rowIndex) => <tr key={row.id} className={selectedRow === rowIndex ? 'is-selected-row' : ''}><th className="report-grid-rowhead"><button type="button" onClick={() => setSelectedRow(rowIndex)}>{rowIndex + 1}</button></th>{row.cells.map((cell, colIndex) => {
              const merge = mergedRegionAt(model.merges, rowIndex, colIndex);
              if (merge && (merge.row !== rowIndex || merge.col !== colIndex)) return null;
              const selected = Boolean(selection && rowIndex >= Math.min(selection.anchorRow, selection.endRow) && rowIndex <= Math.max(selection.anchorRow, selection.endRow) && colIndex >= Math.min(selection.anchorCol, selection.endCol) && colIndex <= Math.max(selection.anchorCol, selection.endCol));
              return <td key={`${row.id}-${colIndex}`} rowSpan={merge?.rowSpan ?? 1} colSpan={merge?.colSpan ?? 1} className={`${selected ? 'is-selected-cell' : ''} ${!model.columns[colIndex]?.visible ? 'is-hidden-column' : ''}`} onClick={(event) => { if (event.shiftKey && selection) setSelection({ ...selection, endRow: rowIndex, endCol: colIndex }); else setSelection({ anchorRow: rowIndex, anchorCol: colIndex, endRow: rowIndex, endCol: colIndex }); setSelectedRow(rowIndex); setSelectedColumn(colIndex); }}>
                <input value={cell} maxLength={240} aria-label={`第 ${rowIndex + 1} 行第 ${colIndex + 1} 列文本`} onFocus={() => { if (!selection) setSelection({ anchorRow: rowIndex, anchorCol: colIndex, endRow: rowIndex, endCol: colIndex }); }} onChange={(event) => updateCell(rowIndex, colIndex, event.target.value)} />
              </td>;
            })}</tr>)}
            {!model.customRows.length && <tr><td colSpan={model.columns.length + 1} className="report-layout-empty">尚无自定义版式行。可插入一行并填写备注、分组说明、审批签字栏等。</td></tr>}
          </tbody></table></div>
          <div className="report-layout-selected-row"><strong>行高</strong><input type="number" min={16} max={120} value={model.customRows[selectedRow]?.height ?? 24} disabled={!model.customRows[selectedRow]} onChange={(event) => updateDefinition((current) => ({ ...current, customRows: current.customRows.map((row, index) => index === selectedRow ? { ...row, height: Math.max(16, Math.min(120, Number(event.target.value) || 16)) } : row) }))} /><span>pt</span><strong>当前选区</strong><span>{selectedMergeArea ? `${selectedMergeArea.rowSpan} 行 × ${selectedMergeArea.colSpan} 列` : '未选择'}</span><span>合并单元格：{model.merges.length} 个区域</span></div>
        </div>}

        {tab === 'page' && <div className="report-designer-props">
          <label className="report-designer-prop"><span>纸张</span><select value={model.page.paper} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, paper: event.target.value as ReportTemplateDefinition['page']['paper'] } }))}><option value="A4">A4</option><option value="A3">A3</option><option value="Letter">Letter</option></select></label>
          <label className="report-designer-prop"><span>方向</span><select value={model.page.orientation} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, orientation: event.target.value as ReportTemplateDefinition['page']['orientation'] } }))}><option value="landscape">横向</option><option value="portrait">纵向</option></select></label>
          <label className="report-page-check"><input type="checkbox" checked={model.page.fitToWidth} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, fitToWidth: event.target.checked } }))} /><span>打印时适配到一页宽度</span></label>
          <label className="report-page-check"><input type="checkbox" checked={model.page.repeatHeader} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, repeatHeader: event.target.checked } }))} /><span>分页时重复数据表头（XLSX）；浏览器打印重复标题区</span></label>
          <label className="report-page-check"><input type="checkbox" checked={model.page.includeDescription} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, includeDescription: event.target.checked } }))} /><span>导出“导出说明”工作表</span></label>
          <label className="report-page-check"><input type="checkbox" checked={model.page.showPageNumber} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, showPageNumber: event.target.checked } }))} /><span>XLSX 页脚显示页码</span></label>
          <label className="report-designer-prop"><span>页脚文本</span><input value={model.page.footerText} maxLength={120} onChange={(event) => updateDefinition((current) => ({ ...current, page: { ...current.page, footerText: event.target.value } }))} /></label>
          <div className="report-page-layout-summary"><TableProperties size={17} /><div><strong>{model.page.paper} · {model.page.orientation === 'landscape' ? '横向' : '纵向'}</strong><span>{outputColumns.length} 个可见列 · {model.customRows.length} 个自定义版式行 · {model.page.fitToWidth ? '一页宽度适配' : '按列宽分页'}</span></div></div>
          <div className="report-scope-editor"><label><span>模板共享范围</span><select value={createScope} onChange={(event) => { setCreateScope(event.target.value as ReportTemplateScope); setDirty(true); }}><option value="PERSONAL">个人模板</option>{filterProjectId && <option value="PROJECT">当前项目共享模板</option>}{canCreateSystem && <option value="SYSTEM">系统模板（管理员）</option>}</select></label><small>发布系统模板只允许管理员；发布项目模板要求项目负责人或项目经理。</small></div>
        </div>}
        {templateId && <details className="report-template-history"><summary><History size={15} />版本历史与恢复</summary><div className="report-template-history-list">{revisionsQuery.isLoading ? <small>正在读取历史版本…</small> : !(revisionsQuery.data ?? []).length ? <small>暂无历史记录。</small> : (revisionsQuery.data ?? []).map((revision) => <div key={revision.id}><span><strong>v{revision.version}</strong><small>{revision.action} · {new Date(revision.createdAt).toLocaleString('zh-CN')}</small></span><button type="button" disabled={busy || !templateEditable} onClick={() => void restoreRevision(revision.id)}>恢复为草稿</button></div>)}</div></details>}
      </aside>

      <section className="report-designer-preview-panel panel">
        <div className="report-preview-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h2><WandSparkles size={18} />{model.title || currentReport.label}</h2><p>预览使用真实权限范围数据；表格显示前 80 条记录，导出文件采用相同模板定义。</p></div><div className="report-preview-count"><strong>{preview ? `${preview.truncated ? '≥' : ''}${preview.rowCount.toLocaleString('zh-CN')}` : '—'}</strong><span>{preview?.truncated ? '条记录（已达展示/导出上限）' : '条已查询记录'}</span></div></div>
        {previewQuery.isLoading ? <LoadingBlock label="正在生成报表预览…" /> : previewQuery.error ? <ErrorBlock message={String(previewQuery.error)} retry={() => void previewQuery.refetch()} /> : <>
          <div className={`report-preview-viewport ${model.page.orientation === 'portrait' ? 'is-portrait' : ''}`}>
            <article className={`report-preview-paper ${printRows === null ? 'report-preview-print-surface' : ''}`} data-paper={model.page.paper}>
              <table className={`report-preview-table ${model.page.repeatHeader ? 'repeat-header' : 'no-repeat-header'} ${model.page.fitToWidth ? 'print-fit-width' : 'print-natural-width'}`}><thead>
                <tr className="report-preview-title-row"><th colSpan={Math.max(1, outputColumns.length)} style={{ height: model.rowHeights.title }}>{model.title}</th></tr>
                {model.subtitle && <tr className="report-preview-subtitle-row"><td colSpan={Math.max(1, outputColumns.length)} style={{ height: model.rowHeights.subtitle }}>{expandedSubtitle(model.subtitle, preview.projectScope, preview.generatedAt, preview.rowCount)}</td></tr>}
                {model.customRows.map((row, rowIndex) => <tr key={row.id} style={{ height: row.height }}>{outputColumns.map((column, outputIndex) => {
                  const sourceCol = visibleIndexes[outputIndex]!;
                  const merge = mappedMerges.find((item) => rowIndex >= item.row && rowIndex < item.row + item.rowSpan && outputIndex >= item.col && outputIndex < item.col + item.colSpan);
                  if (merge && (merge.row !== rowIndex || merge.col !== outputIndex)) return null;
                  return <td key={`${row.id}-${column.id}`} rowSpan={merge?.rowSpan ?? 1} colSpan={merge?.colSpan ?? 1} style={{ width: `${column.width * 7}px`, textAlign: column.align }}>{row.cells[merge?.anchorSourceCol ?? sourceCol] || ''}</td>;
                })}</tr>)}
                <tr className="report-preview-header-row" style={{ height: model.rowHeights.header }}>{outputColumns.map((column) => <th key={column.id} style={{ width: `${column.width * 7}px`, textAlign: column.align }}>{column.label}</th>)}</tr>
              </thead><tbody>
                {(preview.rows ?? []).map((row, rowIndex) => <tr key={`${reportKey}-preview-${rowIndex}`} style={{ height: model.rowHeights.body }}>{outputColumns.map((column) => {
                  const sourceIndex = column.fieldKey ? preview.fields.findIndex((field) => field.key === column.fieldKey) : -1;
                  return <td key={`${column.id}-${rowIndex}`} style={{ textAlign: column.align, width: `${column.width * 7}px` }}>{sourceIndex >= 0 ? formatPreviewValue(row[sourceIndex], column, preview.fields) : column.staticValue || '—'}</td>;
                })}</tr>)}
                {!preview.rows.length && <tr><td colSpan={Math.max(1, outputColumns.length)} className="report-preview-empty">当前筛选范围没有可预览的数据。</td></tr>}
              </tbody></table>
              <footer className="report-preview-footer"><span>{model.page.footerText}</span><span>{preview.previewRowCount} / {preview.rowCount} 行预览 {preview.truncated ? '· 服务端数据达到导出上限' : ''}</span></footer>
            </article>
          </div>
          <div className="report-preview-bottomline"><span><FileSpreadsheet size={14} />{currentReport.label} · {model.page.paper} {model.page.orientation === 'landscape' ? '横向' : '纵向'} · {outputColumns.length} 个可见列</span><span>{dirty ? '版式已变更，保存或导出时将生成新草稿版本' : `当前模板版本：${templateVersion}`}</span></div>
        </>}
        {printRows !== null && preview && <div className="report-print-all" aria-hidden="true">
          <article className="report-preview-paper" data-paper={model.page.paper}>
            <table className={`report-preview-table ${model.page.repeatHeader ? 'repeat-header' : 'no-repeat-header'} ${model.page.fitToWidth ? 'print-fit-width' : 'print-natural-width'}`}><thead>
              <tr className="report-preview-title-row"><th colSpan={Math.max(1, outputColumns.length)} style={{ height: model.rowHeights.title }}>{model.title}</th></tr>
              {model.subtitle && <tr className="report-preview-subtitle-row"><td colSpan={Math.max(1, outputColumns.length)} style={{ height: model.rowHeights.subtitle }}>{expandedSubtitle(model.subtitle, preview.projectScope, preview.generatedAt, preview.rowCount)}</td></tr>}
              {model.customRows.map((row, rowIndex) => <tr key={`print-${row.id}`} style={{ height: row.height }}>{outputColumns.map((column, outputIndex) => {
                const sourceCol = visibleIndexes[outputIndex]!;
                const merge = mappedMerges.find((item) => rowIndex >= item.row && rowIndex < item.row + item.rowSpan && outputIndex >= item.col && outputIndex < item.col + item.colSpan);
                if (merge && (merge.row !== rowIndex || merge.col !== outputIndex)) return null;
                return <td key={`print-${row.id}-${column.id}`} rowSpan={merge?.rowSpan ?? 1} colSpan={merge?.colSpan ?? 1} style={{ width: `${column.width * 7}px`, textAlign: column.align }}>{row.cells[merge?.anchorSourceCol ?? sourceCol] || ''}</td>;
              })}</tr>)}
              <tr className="report-preview-header-row" style={{ height: model.rowHeights.header }}>{outputColumns.map((column) => <th key={`print-${column.id}`} style={{ width: `${column.width * 7}px`, textAlign: column.align }}>{column.label}</th>)}</tr>
            </thead><tbody>
              {printRows.map((row, rowIndex) => <tr key={`${reportKey}-print-${rowIndex}`} style={{ height: model.rowHeights.body }}>{outputColumns.map((column) => {
                const sourceIndex = column.fieldKey ? preview.fields.findIndex((field) => field.key === column.fieldKey) : -1;
                return <td key={`print-${column.id}-${rowIndex}`} style={{ textAlign: column.align, width: `${column.width * 7}px` }}>{sourceIndex >= 0 ? formatPreviewValue(row[sourceIndex], column, preview.fields) : column.staticValue || '—'}</td>;
              })}</tr>)}
              {!printRows.length && <tr><td colSpan={Math.max(1, outputColumns.length)} className="report-preview-empty">当前筛选范围没有数据。</td></tr>}
            </tbody></table>
            <footer className="report-preview-footer"><span>{model.page.footerText}</span><span>{printRows.length.toLocaleString('zh-CN')} 行 · {preview.truncated ? '注意：数据达到单次查询上限，打印内容可能不完整，请缩小筛选范围分批打印。' : '数据完整'}</span></footer>
          </article>
        </div>}
      </section>
    </div>
    <div className="report-designer-footnote"><ShieldCheck size={15} /><span>安全边界：模板仅存放版式、字段白名单与输出参数；不接受 SQL、脚本或任意表达式。服务端会再次检查模板字段与项目权限。XLSX/PDF/打印是只读数据快照，不会回写合同、成本、变更、结算或资金业务。</span></div>
  </div>;
}
