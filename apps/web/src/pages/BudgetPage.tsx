import { useMemo, useRef, useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FolderTree, Import, Pencil, Plus, Upload, X } from 'lucide-react';
import { z } from 'zod';
import { api, ApiError } from '../api';
import { useUiStore } from '../auth-store';
import type { Analysis, BudgetItem } from '../types';
import { Button, EmptyState, ErrorBlock, formatMoney, LoadingBlock, PageHeader, percentage } from '../components/Ui';

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
  const escape = (value: unknown) => { const text = String(value ?? ''); return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; };
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
function BudgetDialog({ projectId, items, editing, onClose }: { projectId: string; items: BudgetItem[]; editing?: BudgetItem; onClose: () => void }) {
  const queryClient = useQueryClient(); const [serverError, setServerError] = useState('');
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<BudgetValues>({ resolver: zodResolver(budgetSchema) as never, defaultValues: editing ? { parentId: editing.parentId ?? '', code: editing.code, name: editing.name, unit: editing.unit ?? '', quantity: editing.quantity ?? '', unitPrice: editing.unitPrice ?? '', totalPrice: editing.totalPrice, sortOrder: editing.sortOrder } : { parentId: '', code: '', name: '', unit: '', quantity: '', unitPrice: '', totalPrice: '', sortOrder: 0 } });
  const quantity = watch('quantity'); const unitPrice = watch('unitPrice'); const totalPrice = watch('totalPrice');
  const submit = handleSubmit(async (values) => {
    setServerError('');
    const body = { ...values, parentId: editing ? (editing.parentId ?? null) : (values.parentId || null), unit: values.unit || null, quantity: values.quantity === '' ? null : Number(values.quantity), unitPrice: values.unitPrice === '' ? null : Number(values.unitPrice), totalPrice: values.totalPrice === '' ? Math.round((Number(values.quantity || 0) * Number(values.unitPrice || 0) + Number.EPSILON) * 100) / 100 : Number(values.totalPrice) };
    try {
      if (editing) await api.patch(`/projects/${projectId}/budget/items/${editing.id}`, body);
      else await api.post(`/projects/${projectId}/budget/items`, body);
      await queryClient.invalidateQueries({ queryKey: ['budget', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] }); await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '保存失败，请检查字段'); }
  });
  const total = totalPrice !== '' && totalPrice !== undefined ? Number(totalPrice) : Number(quantity || 0) * Number(unitPrice || 0);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="dialog" role="dialog" aria-modal="true">
    <div className="dialog-header"><div><span className="eyebrow">TARGET COST / ITEM</span><h2>{editing ? '编辑清单条目' : '新增清单条目'}</h2><p>合价默认由工程量 × 单价计算，亦可手工覆盖。</p></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
    <form onSubmit={submit} noValidate><div className="form-grid two-cols">
      <div className="field"><label>清单编号 <b>*</b></label><input {...register('code')} placeholder="010101" />{errors.code && <small className="field-error">{errors.code.message}</small>}</div>
      <div className="field"><label>上级清单</label><select {...register('parentId')} disabled={Boolean(editing)}><option value="">顶级清单</option>{items.filter((item) => item.id !== editing?.id).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></div>
      <div className="field span-2"><label>清单名称 <b>*</b></label><input {...register('name')} placeholder="分部分项工程名称" />{errors.name && <small className="field-error">{errors.name.message}</small>}</div>
      <div className="field"><label>单位</label><input {...register('unit')} placeholder="m³、t、项" /></div>
      <div className="field"><label>工程量</label><input type="number" min="0" step="0.001" {...register('quantity')} /></div>
      <div className="field"><label>综合单价（元）</label><input type="number" min="0" step="0.0001" {...register('unitPrice')} /></div>
      <div className="field"><label>合价（元）</label><input type="number" min="0" step="0.01" {...register('totalPrice')} placeholder="留空自动计算" /></div>
      <div className="field"><label>排序值</label><input type="number" step="1" {...register('sortOrder')} /></div>
    </div>
    <div className="calculated-total"><span>本条合价预览</span><strong>{formatMoney(total)}</strong></div>
    {serverError && <div className="form-alert">{serverError}</div>}
    <div className="dialog-footer"><Button variant="secondary" onClick={onClose}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? '保存中…' : '保存条目'}</Button></div></form>
  </div></div>;
}

type PreviewRow = { code: string; name: string; parentId?: string | null; unit?: string | null; quantity?: number | null; unitPrice?: number | null; totalPrice?: number; sortOrder?: number; error?: string };

export default function BudgetPage() {
  const projectId = useUiStore((state) => state.selectedProjectId)!;
  const queryClient = useQueryClient(); const fileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<BudgetItem | undefined>(); const [dialogOpen, setDialogOpen] = useState(false);
  const [preview, setPreview] = useState<PreviewRow[] | null>(null); const [notice, setNotice] = useState(''); const [serverError, setServerError] = useState('');
  const budgetQuery = useQuery({ queryKey: ['budget', projectId], queryFn: () => api.get<BudgetItem[]>(`/projects/${projectId}/budget`) });
  const analysisQuery = useQuery({ queryKey: ['analysis', projectId], queryFn: () => api.get<Analysis>(`/projects/${projectId}/analysis/three-way`) });
  const rows = budgetQuery.data ?? [];
  const treeRows = useMemo(() => flattenTree(toTree(rows)), [rows]);
  const rootAndLeafStats = useMemo(() => {
    const idsWithChildren = new Set(rows.map((item) => item.parentId).filter(Boolean));
    const leaves = rows.filter((item) => !idsWithChildren.has(item.id));
    return { targetCost: leaves.reduce((sum, item) => sum + item.totalPrice, 0), leafCount: leaves.length };
  }, [rows]);

  async function readImport(file: File) {
    setNotice(''); setServerError('');
    try {
      const content = parseCsv(await file.text());
      if (content.length < 2) throw new Error('文件没有数据行');
      const headers = content[0].map((v) => v.trim());
      const required = ['code', 'name'];
      if (required.some((key) => !headers.includes(key))) throw new Error('CSV 表头至少需要包含 code、name 两列，可选 parentId、unit、quantity、unitPrice、totalPrice、sortOrder。');
      const get = (row: string[], key: string) => { const i = headers.indexOf(key); return i < 0 ? '' : (row[i] ?? '').trim(); };
      const seen = new Set<string>();
      const parsed: PreviewRow[] = content.slice(1).map((row, index) => {
        const code = get(row, 'code'); const name = get(row, 'name'); const parentId = get(row, 'parentId') || get(row, 'parentCode') || null;
        const numeric = (key: string) => { const value = get(row, key); if (!value) return null; const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : Number.NaN; };
        let error = !code ? '缺少编号' : !name ? '缺少名称' : '';
        if (code && seen.has(code)) error = '编号重复'; if (code) seen.add(code);
        const quantity = numeric('quantity'); const unitPrice = numeric('unitPrice'); const totalPrice = numeric('totalPrice'); const sortValue = numeric('sortOrder');
        if ([quantity, unitPrice, totalPrice, sortValue].some((n) => Number.isNaN(n))) error = '数值列必须为非负数字';
        return { code, name, parentId, unit: get(row, 'unit') || null, quantity, unitPrice, totalPrice: totalPrice ?? undefined, sortOrder: sortValue ?? index, error: error || undefined };
      });
      setPreview(parsed); if (!parsed.length) throw new Error('没有有效数据行');
    } catch (error) { setServerError(error instanceof Error ? error.message : '无法读取文件'); }
    if (fileRef.current) fileRef.current.value = '';
  }

  async function confirmImport() {
    if (!preview) return;
    const invalid = preview.filter((row) => row.error);
    if (invalid.length) { setServerError(`还有 ${invalid.length} 行存在错误，请修正 CSV 后重新上传。`); return; }
    setServerError(''); setNotice('');
    try {
      const result = await api.post<{ imported: number }>(`/projects/${projectId}/budget/import-csv`, { rows: preview.map(({ error: _error, ...row }) => row) });
      await queryClient.invalidateQueries({ queryKey: ['budget', projectId] }); await queryClient.invalidateQueries({ queryKey: ['analysis', projectId] });
      setNotice(`已成功导入 ${result.imported} 条清单记录。`); setPreview(null);
    } catch (error) { setServerError(error instanceof ApiError ? error.message : '导入失败'); }
  }

  if (budgetQuery.isLoading) return <div className="page-wrap"><LoadingBlock /></div>;
  if (budgetQuery.error) return <div className="page-wrap"><ErrorBlock message={(budgetQuery.error as Error).message} retry={() => void budgetQuery.refetch()} /></div>;
  return <div className="page-wrap">
    <PageHeader eyebrow="PROJECT COST / TARGET BUDGET" title="预算与目标成本" subtitle="维护清单层级、计划工程量和目标成本，为实际成本偏差提供对比基准。" actions={<><Button variant="secondary" onClick={() => exportCsv([], `目标成本导入模板.csv`)}><Download size={15} />下载模板</Button><Button variant="secondary" onClick={() => exportCsv(rows, `目标成本清单-${projectId}.csv`)}><Download size={15} />导出 CSV</Button><Button variant="secondary" onClick={() => fileRef.current?.click()}><Upload size={15} />导入 CSV</Button><Button onClick={() => { setEditing(undefined); setDialogOpen(true); }}><Plus size={16} />新增条目</Button></>} />
    <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => { const file = e.target.files?.[0]; if (file) void readImport(file); }} />
    {notice && <div className="success-notice"><FileSpreadsheet size={16} />{notice}</div>}{serverError && <div className="form-alert">{serverError}</div>}
    <div className="budget-summary-grid"><article className="budget-summary-item"><span>目标成本总额</span><strong>{formatMoney(rootAndLeafStats.targetCost)}</strong><small>仅汇总末级清单项，避免父子层级重复计算</small></article><article className="budget-summary-item"><span>清单条目</span><strong>{rows.length.toLocaleString('zh-CN')} <em>条</em></strong><small>末级清单 {rootAndLeafStats.leafCount} 条</small></article><article className="budget-summary-item"><span>实际已录成本</span><strong>{formatMoney(analysisQuery.data?.actualCost)}</strong><small>来自成本录入模块</small></article><article className="budget-summary-item"><span>目标成本偏差</span><strong className={(analysisQuery.data?.actualCost ?? 0) > rootAndLeafStats.targetCost ? 'text-danger' : 'text-success'}>{rootAndLeafStats.targetCost ? percentage(((analysisQuery.data?.actualCost ?? 0) - rootAndLeafStats.targetCost) / rootAndLeafStats.targetCost) : '—'}</strong><small>实际成本 ÷ 目标成本 − 1</small></article></div>
    <section className="panel data-table-panel"><div className="panel-heading"><div><h3>目标成本清单</h3><p><FolderTree size={13} /> 树形层级 · 选择条目可编辑 · 金额单位：人民币元</p></div><div className="table-heading-actions"><button className="button button-ghost button-small" onClick={() => exportCsv(rows, `目标成本清单-${projectId}.csv`)}><Download size={14} />导出</button></div></div>
      {!rows.length ? <EmptyState title="还没有目标成本清单" description="可逐条新增，也可以通过 CSV 导入已有清单数据。" action={() => { setEditing(undefined); setDialogOpen(true); }} /> : <div className="table-scroll"><table className="data-table budget-table"><thead><tr><th>清单编号</th><th>清单名称</th><th>单位</th><th className="align-right">工程量</th><th className="align-right">综合单价</th><th className="align-right">目标合价</th><th className="align-right">已录成本</th><th>操作</th></tr></thead><tbody>{treeRows.map(({ node, depth }) => {
        const actual = rows.length ? (analysisQuery.data?.byBudget.find((b) => b.id === node.id)?.actualCost ?? 0) : 0;
        const isParent = node.children.length > 0;
        return <tr key={node.id} className={isParent ? 'budget-parent-row' : ''}><td><span className="budget-code">{node.code}</span></td><td><span className="tree-name" style={{ paddingLeft: `${depth * 18}px` }}>{isParent ? <span className="tree-branch">−</span> : <span className="tree-leaf-dot" />}{node.name}</span></td><td>{node.unit || '—'}</td><td className="align-right numeric">{node.quantity == null ? '—' : node.quantity.toLocaleString('zh-CN', { maximumFractionDigits: 3 })}</td><td className="align-right numeric">{node.unitPrice == null ? '—' : formatMoney(node.unitPrice)}</td><td className="align-right numeric">{formatMoney(node.totalPrice)}</td><td className={`align-right numeric ${actual > node.totalPrice ? 'text-danger' : ''}`}>{formatMoney(actual)}</td><td><button className="table-action" onClick={() => { setEditing(node); setDialogOpen(true); }}><Pencil size={14} />编辑</button></td></tr>;
      })}</tbody><tfoot><tr><td colSpan={5}>合计（仅末级清单汇总）</td><td className="align-right numeric">{formatMoney(rootAndLeafStats.targetCost)}</td><td className="align-right numeric">{formatMoney(analysisQuery.data?.actualCost)}</td><td /></tr></tfoot></table></div>}
    </section>
    <div className="data-note"><span className="note-mark">i</span><span>本版 CSV 导入要求父级清单在子级之前；导入前会校验必填列、编号重复和数值格式。原生 .xlsx 模板映射尚未实现，可在 Excel 中另存为 CSV UTF-8 后导入。</span></div>

    {dialogOpen && <BudgetDialog projectId={projectId} items={rows} editing={editing} onClose={() => setDialogOpen(false)} />}
    {preview && <div className="modal-backdrop"><div className="dialog import-dialog"><div className="dialog-header"><div><span className="eyebrow">IMPORT PREVIEW</span><h2>导入预览</h2><p>共 {preview.length} 行，错误行不会提交。</p></div><button className="icon-button" onClick={() => setPreview(null)}><X size={18} /></button></div><div className="import-preview-wrap"><table className="data-table"><thead><tr><th>行</th><th>编号</th><th>名称</th><th>上级编号/ID</th><th className="align-right">数量</th><th className="align-right">单价</th><th>校验</th></tr></thead><tbody>{preview.slice(0, 100).map((row, i) => <tr className={row.error ? 'import-row-error' : ''} key={`${row.code}-${i}`}><td>{i + 2}</td><td>{row.code}</td><td>{row.name}</td><td>{row.parentId || '—'}</td><td className="align-right">{row.quantity ?? '—'}</td><td className="align-right">{row.unitPrice ?? '—'}</td><td>{row.error ? <span className="text-danger">{row.error}</span> : <span className="text-success">通过</span>}</td></tr>)}</tbody></table>{preview.length > 100 && <div className="preview-more">仅展示前 100 行，提交时将校验全部 {preview.length} 行。</div>}</div>{serverError && <div className="form-alert">{serverError}</div>}<div className="dialog-footer"><Button variant="secondary" onClick={() => setPreview(null)}>取消</Button><Button onClick={() => void confirmImport()} disabled={preview.some((row) => row.error)}><Import size={15} />确认导入 {preview.length} 行</Button></div></div></div>}
  </div>;
}
