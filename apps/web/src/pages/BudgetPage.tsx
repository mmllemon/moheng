import SelectField from '../components/SelectField';
import { useMemo, useRef, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Download, FileSpreadsheet, Import, MoreHorizontal, Pencil, Plus, Search, Upload, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Analysis, BudgetItem, Project } from '../types';
import { ProjectLedgerReportButton } from '../components/ReportLaunchButton';
import { Button, EmptyState, ErrorBlock, formatMoney, LoadingBlock, Metrics, PageHeader, percentage, StatusBadge } from '../components/Ui';
import { confirmAction } from '../components/ConfirmDialog';

type FlatNode = BudgetItem & { children: FlatNode[] };
function toTree(items: BudgetItem[]): FlatNode[] {
  const map = new Map<string, FlatNode>();
  items.forEach((item) => map.set(item.id, { ...item, children: [] }));
  const roots: FlatNode[] = [];
  map.forEach((node) => {
    const parent = node.parentId ? map.get(node.parentId) : undefined;
    if (parent) parent.children.push(node); else roots.push(node);
  });
  const sort = (nodes: FlatNode[]) => { nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)); nodes.forEach((n) => sort(n.children)); };
  sort(roots);
  const totalChildren = (nodes: FlatNode[]) => nodes.forEach((node) => { totalChildren(node.children); if (node.children.length) node.totalPrice = node.children.reduce((sum, child) => sum + child.totalPrice, 0); });
  totalChildren(roots);
  return roots;
}
function flattenTree(nodes: FlatNode[], depth = 0): { node: FlatNode; depth: number }[] {
  return nodes.flatMap((node) => [{ node, depth }, ...flattenTree(node.children, depth + 1)]);
}
function exportCsv(rows: BudgetItem[], filename: string) {
  const codeById = new Map(rows.map((row) => [row.id, row.code]));
  const escape = (value: unknown) => { let text = String(value ?? ''); const numeric = typeof value === 'number' && Number.isFinite(value); if (!numeric && typeof value === 'string' && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`; return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
  // Parent references are exported as human-readable codes so the file can be imported into another project.
  const body = [['code', 'name', 'parentId', 'unit', 'quantity', 'unitPrice', 'totalPrice', 'sortOrder'], ...rows.map((r) => [r.code, r.name, r.parentId ? (codeById.get(r.parentId) ?? '') : '', r.unit ?? '', r.quantity ?? '', r.unitPrice ?? '', r.totalPrice, r.sortOrder])].map((row) => row.map(escape).join(',')).join('\r\n');
  const blob = new Blob(['\uFEFF', body], { type: 'text/csv;charset=utf-8;' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function parseCsv(text: string): string[][] {
  const result: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (char === '"' && quoted && input[i + 1] === '"') { cell += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { row.push(cell.trim()); cell = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && input[i + 1] === '\n') i += 1;
      row.push(cell.trim()); if (row.some((part) => part !== '')) result.push(row); row = []; cell = '';
    } else cell += char;
  }
  row.push(cell.trim()); if (row.some((part) => part !== '')) result.push(row);
  return result;
}

type BudgetValues = { parentId: string; code: string; name: string; unit: string; quantity: number | ''; unitPrice: number | ''; totalPrice: number | ''; sortOrder: number };
const budgetSchema = z.object({
  parentId: z.string().optional(), code: z.string().trim().min(1, '请输入清单编号'), name: z.string().trim().min(1, '请输入清单名称'),
  unit: z.string().optional(), quantity: z.union([z.literal(''), z.coerce.number().min(0)]), unitPrice: z.union([z.literal(''), z.coerce.number().min(0)]),
  totalPrice: z.union([z.literal(''), z.coerce.number().min(0)]), sortOrder: z.coerce.number().int().default(0),
});
function BudgetDialog({ projectId, items, editing, parentId, onClose }: { projectId: string; items: BudgetItem[]; editing?: BudgetItem; parentId?: string; onClose: () => void }) {
  const queryClient = useQueryClient(); const [serverError, setServerError] = useState('');
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm<BudgetValues>({ resolver: zodResolver(budgetSchema) as never, defaultValues: editing ? { parentId: editing.parentId ?? '', code: editing.code, name: editing.name, unit: editing.unit ?? '', quantity: editing.quantity ?? '', unitPrice: editing.unitPrice ?? '', totalPrice: editing.totalPrice, sortOrder: editing.sortOrder } : { parentId: parentId ?? '', code: '', name: '', unit: '', quantity: '', unitPrice: '', totalPrice: '', sortOrder: 0 } });
  const quantity = watch('quantity'); const unitPrice = watch('unitPrice'); const totalPrice = watch('totalPrice');
  const draftKey = `moheng:budget-draft:${projectId}:${editing?.id ?? 'new'}`;
  const [draftReady, setDraftReady] = useState(false);
  const [draftNotice, setDraftNotice] = useState('');
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsedDraft = JSON.parse(raw) as Partial<BudgetValues>;
        void confirmAction({ title: '恢复本地草稿', description: '发现上次未提交的目标成本清单草稿，是否恢复？草稿只保存在当前浏览器，不会自动写入正式台账。', confirmText: '恢复草稿', cancelText: '丢弃', tone: 'default' }).then((ok) => { if (!ok) { localStorage.removeItem(draftKey); return; }
          reset({
            parentId: parsedDraft.parentId ?? (editing?.parentId ?? ''), code: parsedDraft.code ?? (editing?.code ?? ''), name: parsedDraft.name ?? (editing?.name ?? ''),
            unit: parsedDraft.unit ?? (editing?.unit ?? ''), quantity: parsedDraft.quantity ?? (editing?.quantity ?? ''),
            unitPrice: parsedDraft.unitPrice ?? (editing?.unitPrice ?? ''), totalPrice: parsedDraft.totalPrice ?? (editing?.totalPrice ?? ''), sortOrder: parsedDraft.sortOrder ?? (editing?.sortOrder ?? 0),
          });
          setDraftNotice('已恢复本地草稿；点击“保存条目”后才会写入正式台账。');
        });
      }
    } catch { setDraftNotice('本地草稿无法读取，已继续使用表单当前值。'); }
    setDraftReady(true);
  }, [draftKey, editing, reset]);
  useEffect(() => {
    if (!draftReady) return;
    const subscription = watch((values) => {
      try { localStorage.setItem(draftKey, JSON.stringify(values)); } catch { /* Local drafts are optional when browser storage is unavailable. */ }
    });
    return () => subscription.unsubscribe();
  }, [draftKey, draftReady, watch]);
  function clearLocalDraft() {
    reset(editing ? { parentId: editing.parentId ?? '', code: editing.code, name: editing.name, unit: editing.unit ?? '', quantity: editing.quantity ?? '', unitPrice: editing.unitPrice ?? '', totalPrice: editing.totalPrice, sortOrder: editing.sortOrder } : { parentId: parentId ?? '', code: '', name: '', unit: '', quantity: '', unitPrice: '', totalPrice: '', sortOrder: 0 });
    try { localStorage.removeItem(draftKey); } catch { /* Ignore unavailable local storage. */ }
    setDraftNotice('已清除本地草稿。');
  }
  const submit = handleSubmit(async (values) => {
    setServerError('');
    const body = { ...values, parentId: editing ? (editing.parentId ?? null) : (values.parentId || null), unit: values.unit || null, quantity: values.quantity === '' ? null : Number(values.quantity), unitPrice: values.unitPrice === '' ? null : Number(values.unitPrice), totalPrice: values.totalPrice === '' ? Math.round((Number(values.quantity || 0) * Number(values.unitPrice || 0) + Number.EPSILON) * 100) / 100 : Number(values.totalPrice) };
    try {
      if (editing) await api.patch(`/projects/${projectId}/budget/items/${editing.id}`, body);
      else await api.post(`/projects/${projectId}/budget/items`, body);
      await queryClient.invalidateQueries({ queryKey: ['budget', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      try { localStorage.removeItem(draftKey); } catch { /* Local draft storage is optional. */ }
      onClose();
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '保存失败，请检查字段'); }
  });
  const total = totalPrice !== '' && totalPrice !== undefined ? Number(totalPrice) : Number(quantity || 0) * Number(unitPrice || 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog" role="dialog" aria-modal="true">
    <div className="dialog-header"><div><span className="eyebrow">TARGET COST / ITEM</span><h2>{editing ? '编辑清单条目' : '新增清单条目'}</h2><p>合价默认由工程量 × 单价计算，亦可手工覆盖。</p></div><Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button></div>
    <form onSubmit={submit} noValidate><div className="form-grid two-cols">
      <div className="field"><label>清单编号 <b>*</b></label><input {...register('code')} placeholder="010101" />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
      <div className="field"><label>上级清单</label><SelectField {...register('parentId')} disabled={Boolean(editing)}><option value="">顶级清单</option>{items.filter((item) => item.id !== editing?.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</SelectField></div>
      <div className="field span-2"><label>清单名称 <b>*</b></label><input {...register('name')} placeholder="分部分项工程名称" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
      <div className="field"><label>单位</label><input {...register('unit')} placeholder="m³、t、项" /></div>
      <div className="field"><label>工程量</label><input type="number" min="0" step="0.001" {...register('quantity')} /></div>
      <div className="field"><label>综合单价（元）</label><input type="number" min="0" step="0.0001" {...register('unitPrice')} /></div>
      <div className="field"><label>合价（元）</label><input type="number" min="0" step="0.01" {...register('totalPrice')} placeholder="留空自动计算" /></div>
      <div className="field"><label>排序值</label><input type="number" step="1" {...register('sortOrder')} /></div>
    </div>
    <div className="calculated-total"><span>本条合价预览</span><strong>{formatMoney(total)}</strong></div>
    {draftNotice && <div className="inline-notice"><FileSpreadsheet size={15} /><span>{draftNotice}</span></div>}
    {serverError && <div className="form-alert">{serverError}</div>}
    <div className="dialog-footer"><Button variant="ghost" type="button" onClick={clearLocalDraft}>清除本地草稿</Button><Button variant="secondary" onClick={onClose}>稍后继续</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存条目'}</Button></div></form>
  </div></div>;
}

type PreviewRow = { code: string; name: string; parentId?: string | null; unit?: string | null; quantity?: number | null; unitPrice?: number | null; totalPrice?: number; sortOrder?: number; error?: string };
type ImportField = 'code' | 'name' | 'parentId' | 'unit' | 'quantity' | 'unitPrice' | 'totalPrice' | 'sortOrder';
type ImportMapping = Record<ImportField, string>;
type RawBudgetImport = { format: 'csv' | 'xlsx'; headers: string[]; rows: string[][]; cellTypes?: string[][] };
const importFields: Array<{ key: ImportField; label: string; required?: boolean }> = [
  { key: 'code', label: '清单编号', required: true }, { key: 'name', label: '清单名称', required: true },
  { key: 'parentId', label: '上级编号 / ID' }, { key: 'unit', label: '单位' }, { key: 'quantity', label: '工程量' },
  { key: 'unitPrice', label: '综合单价' }, { key: 'totalPrice', label: '目标合价' }, { key: 'sortOrder', label: '排序值' },
];
const importHeaderAliases: Record<ImportField, string[]> = {
  code: ['code', '编号', '清单编号', '项目编号'], name: ['name', '名称', '清单名称', '项目名称'],
  parentId: ['parentId', 'parentCode', '上级编号', '上级清单编号', '上级ID', '上级清单'], unit: ['unit', '单位'],
  quantity: ['quantity', '工程量', '数量'], unitPrice: ['unitPrice', '单价', '综合单价'],
  totalPrice: ['totalPrice', '合价', '目标合价', '目标成本'], sortOrder: ['sortOrder', '排序值', '排序'],
};
function suggestImportMapping(headers: string[]): ImportMapping {
  const normalize = (value: string) => value.replace(/[\s_（）()]/g, '').toLocaleLowerCase();
  const normalized = headers.map(normalize);
  return Object.fromEntries(importFields.map(({ key }) => {
    const aliases = importHeaderAliases[key].map(normalize);
    const index = normalized.findIndex((header) => aliases.includes(header));
    return [key, index >= 0 ? headers[index] : ''];
  })) as ImportMapping;
}

export default function BudgetPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!;
  const queryClient = useQueryClient(); const fileRef = useRef<HTMLInputElement>(null); const xlsxFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<BudgetItem | undefined>(); const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null); const [rawImport, setRawImport] = useState<RawBudgetImport | null>(null); const [columnMap, setColumnMap] = useState<ImportMapping>({ code: '', name: '', parentId: '', unit: '', quantity: '', unitPrice: '', totalPrice: '', sortOrder: '' }); const [mappingDirty, setMappingDirty] = useState(false); const [notice, setNotice] = useState(''); const [serverError, setServerError] = useState('');
  const budgetQuery = useQuery({ queryKey: ['budget', projectId], queryFn: () => api.get<BudgetItem[]>(`/projects/${projectId}/budget`) });
  const analysisQuery = useQuery({ queryKey: ['analysis', projectId], queryFn: () => api.get<Analysis>(`/projects/${projectId}/analysis/three-way`) });
  const rows = budgetQuery.data ?? [];
  const treeRows = useMemo(() => flattenTree(toTree(rows)), [rows]);
  const rootAndLeafStats = useMemo(() => {
    const idsWithChildren = new Set(rows.map((item) => item.parentId).filter(Boolean));
    const leaves = rows.filter((item) => !idsWithChildren.has(item.id));
    return { targetCost: leaves.reduce((sum, item) => sum + item.totalPrice, 0), leafCount: leaves.length };
  }, [rows]);

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: () => api.get<Project[]>('/projects') });
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const treeRoots = useMemo(() => toTree(rows), [rows]);
  const categories = useMemo(() => treeRoots.map((root) => ({ id: root.id, label: root.name, count: flattenTree([root]).length })), [treeRoots]);
  const allParentIds = useMemo(() => new Set(rows.map((item) => item.parentId).filter((id): id is string => Boolean(id))), [rows]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerItem, setDrawerItem] = useState<BudgetItem | null>(null);
  const [newParentId, setNewParentId] = useState<string | undefined>(undefined);
  const queryText = search.trim().toLocaleLowerCase();
  const flattenVisible = (nodes: FlatNode[], depth = 0): Array<{ node: FlatNode; depth: number }> => nodes.flatMap((node) => [{ node, depth }, ...(collapsed.has(node.id) || queryText ? [] : flattenVisible(node.children, depth + 1))]);
  const visibleRows = useMemo(() => {
    const scoped = category === 'ALL' ? treeRoots : treeRoots.filter((root) => root.id === category);
    if (queryText) return flattenTree(scoped).filter(({ node }) => `${node.code} ${node.name}`.toLocaleLowerCase().includes(queryText));
    return flattenVisible(scoped);
  }, [treeRoots, category, queryText, collapsed]);
  const allCollapsed = allParentIds.size > 0 && [...allParentIds].every((id) => collapsed.has(id));
  const allVisibleSelected = visibleRows.length > 0 && visibleRows.every(({ node }) => selected.has(node.id));
  const actualByBudget = useMemo(() => new Map((analysisQuery.data?.byBudget ?? []).map((row) => [row.id, row.actualCost])), [analysisQuery.data?.byBudget]);
  const actualTotal = analysisQuery.data?.actualCost ?? 0;
  const remaining = rootAndLeafStats.targetCost - actualTotal;
  const asOf = (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; })();
  const costExecution = rootAndLeafStats.targetCost > 0 ? actualTotal / rootAndLeafStats.targetCost : null;
  function actualFor(item: BudgetItem) { return actualByBudget.get(item.id) ?? 0; }
  function toggleSelected(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAllVisible() { setSelected(allVisibleSelected ? new Set() : new Set(visibleRows.map(({ node }) => node.id))); }
  function toggleCollapsed(id: string) { setCollapsed((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleAllCollapsed() { setCollapsed(allCollapsed ? new Set() : new Set(allParentIds)); }
  function openNew(parent?: string) { setEditing(undefined); setNewParentId(parent); setDialogOpen(true); }
  function openEdit(item: BudgetItem) { setEditing(item); setNewParentId(undefined); setDialogOpen(true); }
  function exportSelected() { exportCsv(rows.filter((item) => selected.has(item.id)), `目标成本清单-所选-${projectId}.csv`); }
  const drawerParent = drawerItem?.parentId ? rows.find((item) => item.id === drawerItem.parentId) : undefined;
  const drawerChildren = drawerItem ? rows.filter((item) => item.parentId === drawerItem.id) : [];
  useEffect(() => {
    if (!drawerItem) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setDrawerItem(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerItem]);

  function mapImportRows(raw: RawBudgetImport, mapping: ImportMapping): PreviewRow[] {
    const selected = importFields.map(({ key }) => mapping[key]).filter(Boolean);
    if (!mapping.code || !mapping.name) throw new Error('请为“清单编号”和“清单名称”指定来源列。');
    if (new Set(selected).size !== selected.length) throw new Error('同一 CSV 列不能映射给多个字段，请调整列映射。');
    return raw.rows.map((row, index) => {
      const get = (key: ImportField) => { const header = mapping[key]; const i = header ? raw.headers.indexOf(header) : -1; return i < 0 ? '' : (row[i] ?? '').trim(); };
      const code = get('code'); const name = get('name'); const parentId = get('parentId') || null;
      const numeric = (key: 'quantity' | 'unitPrice' | 'totalPrice' | 'sortOrder') => { const value = get(key); if (!value) return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : Number.NaN; };
      let error = !code ? '缺少编号' : !name ? '缺少名称' : '';
      const quantity = numeric('quantity'); const unitPrice = numeric('unitPrice'); const totalPrice = numeric('totalPrice'); const sortValue = numeric('sortOrder');
      if ([quantity, unitPrice, totalPrice, sortValue].some((n) => Number.isNaN(n))) error = [error, '数值列必须为非负数字'].filter(Boolean).join('；');
      if (raw.format === 'xlsx' && raw.cellTypes) {
        const codeIndex = raw.headers.indexOf(mapping.code);
        const parentIndex = mapping.parentId ? raw.headers.indexOf(mapping.parentId) : -1;
        if (code && codeIndex >= 0 && raw.cellTypes[index]?.[codeIndex] === 'number') error = [error, '编号单元格是数值类型，可能已丢失前导零；请在 Excel/WPS 中改为文本格式后重新上传'].filter(Boolean).join('；');
        if (parentId && parentIndex >= 0 && raw.cellTypes[index]?.[parentIndex] === 'number') error = [error, '上级编号单元格是数值类型，可能已丢失前导零；请改为文本格式后重新上传'].filter(Boolean).join('；');
      }
      return { code, name, parentId, unit: get('unit') || null, quantity, unitPrice, totalPrice: totalPrice ?? undefined, sortOrder: sortValue ?? index, error: error || undefined };
    });
  }

  async function buildImportPreview(raw: RawBudgetImport, mapping: ImportMapping) {
    setServerError('');
    try {
      const parsed = mapImportRows(raw, mapping);
      const seen = new Set<string>();
      for (const row of parsed) {
        if (row.code && seen.has(row.code)) row.error = [row.error, '编号重复'].filter(Boolean).join('；');
        if (row.code) seen.add(row.code);
      }
      if (!parsed.length) throw new Error('没有有效数据行');
      const previewResult = await api.post<{ rows: Array<{ rowNumber: number; valid: boolean; errors: string[] }>; canImport: boolean; invalidCount: number }>(`/projects/${projectId}/budget/import/preview`, {
        rows: parsed.map(({ error: _localError, ...row }) => row),
      });
      const merged = parsed.map((row, index) => {
        const remote = previewResult.rows[index];
        const issues = [row.error, ...(remote?.errors ?? [])].filter(Boolean);
        return { ...row, error: issues.length ? [...new Set(issues)].join('；') : undefined };
      });
      setPreview(merged); setMappingDirty(false);
      if (previewResult.invalidCount) setServerError(`服务端预检发现 ${previewResult.invalidCount} 行有问题。修正错误或调整列映射后重新校验；未导入任何记录。`);
    } catch (error) { setServerError(error instanceof Error ? error.message : `无法校验 ${raw.format.toUpperCase()} 文件`); setPreview(null); }
  }

  function arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    return window.btoa(binary);
  }

  async function readImport(file: File) {
    setNotice(''); setServerError(''); setPreview(null); setRawImport(null);
    try {
      if (file.name.toLocaleLowerCase().endsWith('.xlsx')) {
        if (file.size > 8 * 1024 * 1024) throw new Error('XLSX 文件不能超过 8 MB。');
        const workbookBase64 = arrayBufferToBase64(await file.arrayBuffer());
        const inspected = await api.post<{ sheetName: string; headers: string[]; rows: string[][]; cellTypes: string[][]; rowCount: number; maxRows: number }>(`/projects/${projectId}/budget/import-xlsx/inspect`, { filename: file.name, workbookBase64 });
        const headers = inspected.headers.map((header) => header.trim());
        if (headers.some((header) => !header)) throw new Error('XLSX 存在空表头，请修正后重试。');
        const normalizedHeaders = headers.map((header) => header.replace(/[\s_（）()]/g, '').toLocaleLowerCase());
        if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new Error('XLSX 存在重复表头，请为每一列设置唯一名称。');
        const raw: RawBudgetImport = { format: 'xlsx', headers, rows: inspected.rows, cellTypes: inspected.cellTypes };
        const mapping = suggestImportMapping(headers);
        setRawImport(raw); setColumnMap(mapping);
        if (!mapping.code || !mapping.name) {
          setMappingDirty(true); setPreview([]); setServerError(`已读取工作表“${inspected.sheetName}”，但无法自动识别编号或名称，请手工设置映射。`); return;
        }
        setMappingDirty(false);
        await buildImportPreview(raw, mapping);
      } else {
        if (!file.name.toLocaleLowerCase().endsWith('.csv')) throw new Error('仅支持 .csv 或 .xlsx 文件。');
        const content = parseCsv(await file.text());
        if (content.length < 2) throw new Error('文件没有数据行');
        const headers = content[0].map((v) => v.trim());
        if (headers.some((header) => !header)) throw new Error('CSV 存在空表头，请修正后重试。');
        const normalizedHeaders = headers.map((header) => header.replace(/[\s_（）()]/g, '').toLocaleLowerCase());
        if (new Set(normalizedHeaders).size !== normalizedHeaders.length) throw new Error('CSV 存在重复表头，请先为每一列设置唯一名称。');
        const raw: RawBudgetImport = { format: 'csv', headers, rows: content.slice(1) };
        const mapping = suggestImportMapping(headers);
        if (!mapping.code || !mapping.name) {
          setRawImport(raw); setColumnMap(mapping); setMappingDirty(true); setPreview([]);
          setServerError('无法自动识别清单编号或清单名称，请在预览中手工设置列映射。');
          return;
        }
        setRawImport(raw); setColumnMap(mapping); setMappingDirty(false);
        await buildImportPreview(raw, mapping);
      }
    } catch (error) { setServerError(error instanceof ApiError ? error.message : error instanceof Error ? error.message : '无法读取文件'); }
    finally { if (fileRef.current) fileRef.current.value = ''; if (xlsxFileRef.current) xlsxFileRef.current.value = ''; }
  }

  async function confirmImport() {
    if (!preview || !rawImport) return;
    if (mappingDirty) { setServerError('列映射已更改，请先点击“重新校验映射”。'); return; }
    const invalid = preview.filter((row) => row.error);
    if (invalid.length) { setServerError(`还有 ${invalid.length} 行存在错误，请修正 ${rawImport.format.toUpperCase()} 后重新上传。`); return; }
    setServerError(''); setNotice('');
    try {
      const cleanRows = preview.map(({ error: _error, ...row }) => row);
      const preflight = await api.post<{ canImport: boolean; invalidCount: number; rows: Array<{ rowNumber: number; valid: boolean; errors: string[] }> }>(`/projects/${projectId}/budget/import/preview`, { rows: cleanRows });
      if (!preflight.canImport) {
        setPreview(preview.map((row, index) => ({ ...row, error: preflight.rows[index]?.errors.join('；') || row.error || undefined })));
        setServerError('预检后发现数据或编号状态已变化，未导入任何记录。请检查错误行后重试。');
        return;
      }
      const result = await api.post<{ imported: number; sourceFormat: 'CSV' | 'XLSX' }>(`/projects/${projectId}/budget/import`, { rows: cleanRows, sourceFormat: rawImport.format.toUpperCase() });
      await queryClient.invalidateQueries({ queryKey: ['budget', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setNotice(`已成功导入 ${result.imported} 条 ${result.sourceFormat} 清单记录。`); setPreview(null); setRawImport(null);
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '导入失败'); }
  }

  async function downloadXlsxTemplate() {
    setServerError(''); setNotice('');
    try {
      const blob = await api.download(`/projects/${projectId}/budget/import-template.xlsx`);
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a');
      anchor.href = url; anchor.download = '墨衡-目标成本导入模板.xlsx'; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1200);
      setNotice('已下载原生 XLSX 目标成本模板，请按“填报说明”填写后导入。');
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '下载 XLSX 模板失败'); }
  }

  if (budgetQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (budgetQuery.error) return <div className="page-wrap"><ErrorBlock message={(budgetQuery.error as Error).message} retry={() => void budgetQuery.refetch()} /></div>;
  return <div className="page-wrap budget-page">
    <PageHeader
      title="预算与目标成本"
      context={<><span className="page-context-dot" /><span>{project?.name ?? analysisQuery.data?.project.name ?? '当前项目'}</span><span>· {project?.code ?? analysisQuery.data?.project.code ?? projectId}</span>{project && <><span>·</span><StatusBadge status={project.status} /></>}<span>· 项目级视图</span><span>· 数据截至 {asOf}</span></>}
      actions={<>
        <details className="ldg-import">
          <summary className="button button-secondary"><Upload size={15} />导入<ChevronDown size={13} /></summary>
          <div className="ldg-import-menu">
            <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); fileRef.current?.click(); }}>导入 CSV</button>
            <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); xlsxFileRef.current?.click(); }}>导入 XLSX</button>
            <span className="ldg-menu-sep" />
            <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); exportCsv([], '目标成本导入模板.csv'); }}>CSV 模板</button>
            <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); void downloadXlsxTemplate(); }}>XLSX 模板</button>
            <span className="ldg-menu-sep" />
            <button type="button" onClick={(event) => { (event.currentTarget.closest('details') as HTMLDetailsElement | null)?.removeAttribute('open'); exportCsv(rows, `目标成本清单-${projectId}.csv`); }}>导出全部 CSV</button>
          </div>
        </details>
        <Button onClick={() => openNew()}><Plus size={16} />新增清单</Button>
      </>}
    />
    <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void readImport(file); }} /><input ref={xlsxFileRef} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void readImport(file); }} />
    {notice && <div className="success-notice"><FileSpreadsheet size={16} />{notice}</div>}{serverError && <div className="form-alert">{serverError}</div>}

    <Metrics items={[
      { label: '目标成本总额', value: formatMoney(rootAndLeafStats.targetCost, 0), detail: `末级清单 ${rootAndLeafStats.leafCount} 条 · 共 ${rows.length} 条` },
      { label: '已录成本', value: formatMoney(actualTotal, 0), detail: '来自成本录入模块' },
      { label: '成本余量', value: formatMoney(remaining, 0), detail: '目标成本 − 已录成本', tone: remaining < 0 ? 'danger' : 'default' },
      { label: '成本执行率', value: costExecution == null ? '—' : percentage(costExecution), detail: '已录成本 ÷ 目标成本', tone: costExecution != null && costExecution > 1 ? 'danger' : 'default' },
    ]} />

    <section className="ldg-section">
      {/* 卡头在卡外：标题与操作行属于页面结构，卡片只装内容。 */}
      <div className="ldg-section-head"><div><h2>成本清单</h2><p>按清单层级归集目标成本；展开父级查看子项，点击行查看清单明细。</p></div><span className="ldg-section-count">{rows.length} 条清单</span></div>
      <div className="ldg-section-card">
    <div className="ldg-toolbar">
      <label className="ldg-search"><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索清单编号或名称" aria-label="搜索清单编号或名称" /></label>
      <div className="ldg-segments" role="group" aria-label="按清单分类筛选">
        <button type="button" className={category === 'ALL' ? 'active' : ''} onClick={() => setCategory('ALL')}>全部 <b>{rows.length}</b></button>
        {categories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'active' : ''} onClick={() => setCategory(item.id)}>{item.label} <b>{item.count}</b></button>)}
      </div>
      <div className="ldg-tools">
        <button type="button" className="ldg-tool-link" onClick={toggleAllCollapsed}>{allCollapsed ? '展开全部' : '收起全部'}</button>
        <button type="button" className="button button-secondary button-small" onClick={() => exportCsv(rows, `目标成本清单-${projectId}.csv`)}><Download size={14} />导出</button>
      </div>
    </div>

    {selected.size > 0 && <div className="ldg-selected"><span>已选 {selected.size} 项</span><button type="button" onClick={exportSelected}><Download size={13} />导出所选</button><button type="button" onClick={() => setSelected(new Set())}>清除</button></div>}

    {!rows.length ? <div className="ldg-empty">
      <div className="ldg-empty-art"><span /><span /><span /></div>
      <h3>还没有目标成本清单</h3>
      <p>从零建立清单层级，或导入已有 CSV / XLSX。清单层级只用于成本归集，不参与合同金额计算。</p>
      <div><Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} />导入 CSV</Button><Button onClick={() => openNew()}><Plus size={15} />新增第一条</Button></div>
    </div> : <div className="table-scroll ldg-table-wrap">
      <table className="data-table ldg-table">
        <thead><tr><th className="ldg-check"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAllVisible} aria-label="选择当前可见清单" /></th><th>编号</th><th>清单名称</th><th>单位</th><th className="align-right">工程量</th><th className="align-right">综合单价</th><th className="align-right">目标合价</th><th className="align-right">已录成本</th><th><span className="sr-only">操作</span></th></tr></thead>
        <tbody>{visibleRows.length ? visibleRows.map(({ node, depth }) => {
          const isParent = node.children.length > 0;
          const actual = actualFor(node);
          return <tr key={node.id} className={isParent ? 'ldg-parent-row' : ''} tabIndex={0} onClick={() => setDrawerItem(node)} onKeyDown={(event) => { if (event.key === 'Enter') setDrawerItem(node); }}>
            <td className="ldg-check" onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(node.id)} onChange={() => toggleSelected(node.id)} aria-label={`选择 ${node.name}`} /></td>
            <td><span className="ldg-code">{node.code}</span></td>
            <td><div className="ldg-name" style={{ paddingLeft: `${depth * 18}px` }}>{isParent ? <button type="button" className="ldg-tree-toggle" onClick={(event) => { event.stopPropagation(); toggleCollapsed(node.id); }} aria-label={collapsed.has(node.id) ? '展开子项' : '收起子项'}>{collapsed.has(node.id) ? '+' : '−'}</button> : <span className="ldg-leaf-dot" />}<span>{node.name}</span></div></td>
            <td>{node.unit || '—'}</td>
            <td className="align-right numeric">{node.quantity == null ? '—' : node.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 3 })}</td>
            <td className="align-right numeric">{node.unitPrice == null ? '—' : formatMoney(node.unitPrice)}</td>
            <td className="align-right numeric ldg-strong">{formatMoney(node.totalPrice, 0)}</td>
            <td className={`align-right numeric ${actual > node.totalPrice ? 'text-danger' : ''}`}>{formatMoney(actual, 0)}</td>
            <td><div className="ldg-row-actions"><button type="button" className="ldg-text-action" onClick={(event) => { event.stopPropagation(); isParent ? openNew(node.id) : openEdit(node); }}>{isParent ? '新增子项' : '编辑'}</button><button type="button" className="ldg-more" aria-label={`打开 ${node.name} 明细`} onClick={(event) => { event.stopPropagation(); setDrawerItem(node); }}><MoreHorizontal size={15} /></button></div></td>
          </tr>;
        }) : <tr><td colSpan={9}><div className="ldg-empty-row">没有匹配的清单条目。</div></td></tr>}</tbody>
        <tfoot><tr><td colSpan={6}>合计（{rows.length} 条 · 仅末级汇总）</td><td className="align-right numeric">{formatMoney(rootAndLeafStats.targetCost, 0)}</td><td className="align-right numeric">{formatMoney(actualTotal, 0)}</td><td /></tr></tfoot>
      </table>
    </div>}
      </div>
    </section>

    <div className="ldg-note"><span className="note-mark">i</span><span>目标成本仅汇总末级清单；已录成本按发生日期计入，不含已归档记录。清单层级用于成本归集，不参与合同金额计算。CSV / XLSX 导入会执行服务端重复编号、父级关系与数值复检。</span></div>

    {drawerItem && <div className="ldg-drawer-layer" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDrawerItem(null); }}>
      <aside className="ldg-drawer" role="dialog" aria-modal="true" aria-labelledby="ldg-drawer-title">
        <header className="ldg-drawer-head"><div><span>清单明细 · {drawerItem.code}</span><h2 id="ldg-drawer-title">{drawerItem.name}</h2><p>{drawerParent ? `${drawerParent.code} / ${drawerParent.name}` : '顶级清单'}{drawerChildren.length ? ` · ${drawerChildren.length} 个下级` : ''}</p></div><button type="button" className="ldg-drawer-close" onClick={() => setDrawerItem(null)} aria-label="关闭清单明细"><X size={18} /></button></header>
        <div className="ldg-drawer-body">
          <h3>计量与金额</h3>
          <dl className="ldg-detail-list">
            <div><dt>单位</dt><dd>{drawerItem.unit || '—'}</dd></div>
            <div><dt>工程量</dt><dd>{drawerItem.quantity == null ? '—' : drawerItem.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 3 })}</dd></div>
            <div><dt>综合单价</dt><dd>{drawerItem.unitPrice == null ? '—' : formatMoney(drawerItem.unitPrice)}</dd></div>
            <div><dt>目标合价</dt><dd>{formatMoney(drawerItem.totalPrice, 0)}</dd></div>
            <div><dt>已录成本</dt><dd>{formatMoney(actualFor(drawerItem), 0)}</dd></div>
            <div><dt>成本余量</dt><dd className={drawerItem.totalPrice - actualFor(drawerItem) < 0 ? 'text-danger' : ''}>{formatMoney(drawerItem.totalPrice - actualFor(drawerItem), 0)}</dd></div>
          </dl>
          {drawerChildren.length > 0 && <><h3>下级清单</h3><div className="ldg-child-list">{drawerChildren.map((child) => <button type="button" key={child.id} onClick={() => setDrawerItem(child)}><span>{child.code}</span><strong>{child.name}</strong><small>{formatMoney(child.totalPrice, 0)}</small></button>)}</div></>}
          <h3>成本记录</h3>
          <p className="ldg-drawer-copy">该清单已关联实际成本 {formatMoney(actualFor(drawerItem))}。逐条发生日期、供应商与合同关联请在 <Link to="/cost/costs" onClick={() => setDrawerItem(null)}>实际成本台账</Link> 查看。</p>
        </div>
        <footer className="ldg-drawer-foot"><Button variant="secondary" onClick={() => setDrawerItem(null)}>关闭</Button><Button variant="secondary" onClick={() => { const id = drawerItem.id; setDrawerItem(null); openNew(id); }}><Plus size={14} />新增子项</Button><Button onClick={() => { const item = drawerItem; setDrawerItem(null); openEdit(item); }}><Pencil size={14} />编辑清单</Button></footer>
      </aside>
    </div>}

    {dialogOpen && <BudgetDialog projectId={projectId} items={rows} editing={editing} parentId={newParentId} onClose={() => setDialogOpen(false)} />}
    {preview && <div className="modal-backdrop"><div className="dialog import-dialog"><div className="dialog-header"><div><span className="eyebrow">IMPORT PREVIEW</span><h2>导入预览</h2><p>共 {preview.length} 行，错误行不会提交。</p></div><Button variant="ghost" size="icon" onClick={() => { setPreview(null); setRawImport(null); setMappingDirty(false); }} aria-label="关闭导入预览"><X size={18} /></Button></div><div className="import-mapping-panel"><div className="import-mapping-heading"><div><strong>字段映射</strong><small>系统先按常见中英文表头自动匹配，请核对后重新校验。</small></div><Button type="button" variant="secondary" onClick={() => rawImport && void buildImportPreview(rawImport, columnMap)} disabled={!rawImport || !columnMap.code || !columnMap.name || !mappingDirty}>重新校验映射</Button></div><div className="import-mapping-grid">{importFields.map((field) => <label className="import-mapping-field" key={field.key}><span>{field.label}{field.required ? ' *' : ''}</span><SelectField aria-label={`${field.label}来源列`} value={columnMap[field.key]} onChange={(event) => { setColumnMap((current) => ({ ...current, [field.key]: event.target.value })); setMappingDirty(true); }}><option value="">不映射</option>{rawImport?.headers.map((header, index) => <option key={`${header}-${index}`} value={header}>{header}</option>)}</SelectField></label>)}</div>{mappingDirty && <small className="import-mapping-warning">当前映射尚未重新校验，不能确认导入。</small>}</div><div className="import-preview-wrap"><table className="data-table"><thead><tr><th>行</th><th>编号</th><th>名称</th><th>上级编号/ID</th><th className="align-right">数量</th><th className="align-right">单价</th><th>校验</th></tr></thead><tbody>{preview.slice(0, 100).map((row, i) => <tr className={row.error ? 'import-row-error' : ''} key={`${row.code}-${i}`}><td>{i + 2}</td><td>{row.code}</td><td>{row.name}</td><td>{row.parentId || '—'}</td><td className="align-right">{row.quantity ?? '—'}</td><td className="align-right">{row.unitPrice ?? '—'}</td><td>{row.error ? <span className="text-danger">{row.error}</span> : <span className="text-success">通过</span>}</td></tr>)}</tbody></table>{preview.length > 100 && <div className="preview-more">仅展示前 100 行，提交时将校验全部 {preview.length} 行。</div>}</div>{serverError && <div className="form-alert">{serverError}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={() => { setPreview(null); setRawImport(null); setMappingDirty(false); }}>取消</Button><Button onClick={() => void confirmImport()} disabled={!rawImport || mappingDirty || preview.some((row) => row.error) || !columnMap.code || !columnMap.name}><Import size={15} />确认导入 {preview.length} 行</Button></div></div></div>}
  </div>;
}
