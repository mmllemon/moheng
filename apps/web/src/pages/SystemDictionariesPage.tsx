import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, CheckCircle2, CircleOff, Plus, RefreshCw, Save } from 'lucide-react';
import { Navigate } from 'react-router-dom';
import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { ErrorBlock, LoadingBlock, PageHeader } from '../components/Ui';
import { suggestCodeFromName } from '../utils/code-suggestion';

type DictionaryItem = { id: string; dictionaryId: string; code: string; name: string; description: string | null; sortOrder: number; isSystem: boolean; isActive: boolean; updatedAt: string };
type Dictionary = { id: string; code: string; name: string; description: string | null; isSystem: boolean; isActive: boolean; items: DictionaryItem[]; updatedAt: string };

function DictionaryCard({ dictionary, selected, onSelect, onPatch, saving }: {
  dictionary: Dictionary; selected: boolean; onSelect: () => void;
  onPatch: (input: { id: string; name?: string; description?: string | null; isActive?: boolean }) => void; saving: boolean;
}) {
  const [name, setName] = useState(dictionary.name);
  const [description, setDescription] = useState(dictionary.description ?? '');
  useEffect(() => { setName(dictionary.name); setDescription(dictionary.description ?? ''); }, [dictionary.name, dictionary.description]);
  return <article className={`system-dictionary-card ${selected ? 'is-selected' : ''} ${!dictionary.isActive ? 'is-disabled' : ''}`}>
    <button type="button" className="system-dictionary-card-title" onClick={onSelect} aria-pressed={selected}>
      <span className="system-dictionary-icon"><BookOpen size={16} /></span><span><strong>{dictionary.name}</strong><small>{dictionary.code} · {dictionary.items.length} 项{dictionary.isSystem ? ' · 内置' : ' · 自定义'}</small></span>
      <em>{dictionary.isActive ? '启用' : '停用'}</em>
    </button>
    <label className="system-config-field"><span>分类名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
    <label className="system-config-field"><span>说明</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="用途与维护说明" /></label>
    <div className="system-dictionary-card-actions">
      <button type="button" className="button-secondary" disabled={saving || (name.trim() === dictionary.name && description === (dictionary.description ?? ''))} onClick={() => onPatch({ id: dictionary.id, name: name.trim(), description: description.trim() || null })}><Save size={13} />保存资料</button>
      <button type="button" className="button-secondary" disabled={saving || (dictionary.isSystem && dictionary.isActive)} onClick={() => onPatch({ id: dictionary.id, isActive: !dictionary.isActive })}>{dictionary.isActive ? <CircleOff size={13} /> : <CheckCircle2 size={13} />}{dictionary.isActive ? '停用分类' : '重新启用'}</button>
    </div>
  </article>;
}

function DictionaryItemRow({ item, onPatch, saving }: { item: DictionaryItem; onPatch: (input: { id: string; name?: string; description?: string | null; sortOrder?: number; isActive?: boolean }) => void; saving: boolean }) {
  const [name, setName] = useState(item.name);
  const [description, setDescription] = useState(item.description ?? '');
  const [sortOrder, setSortOrder] = useState(String(item.sortOrder));
  useEffect(() => { setName(item.name); setDescription(item.description ?? ''); setSortOrder(String(item.sortOrder)); }, [item.name, item.description, item.sortOrder]);
  const dirty = name.trim() !== item.name || description !== (item.description ?? '') || Number(sortOrder) !== item.sortOrder;
  return <tr>
    <td><strong>{item.code}</strong>{item.isSystem && <small>内置编码</small>}</td>
    <td><input aria-label={`${item.code} 显示名称`} className="system-config-table-input" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></td>
    <td><input aria-label={`${item.code} 说明`} className="system-config-table-input" value={description} onChange={(event) => setDescription(event.target.value)} maxLength={1000} placeholder="—" /></td>
    <td><input aria-label={`${item.code} 排序`} className="system-config-order-input" type="number" value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} min={-100000} max={100000} /></td>
    <td><span className={`system-config-state ${item.isActive ? 'is-active' : 'is-inactive'}`}>{item.isActive ? '启用' : '停用'}</span></td>
    <td><div className="system-config-row-actions"><button type="button" className="button-secondary" disabled={saving || !dirty || !name.trim() || !Number.isInteger(Number(sortOrder))} onClick={() => onPatch({ id: item.id, name: name.trim(), description: description.trim() || null, sortOrder: Number(sortOrder) })}>保存</button><button type="button" className="button-secondary" disabled={saving} onClick={() => onPatch({ id: item.id, isActive: !item.isActive })}>{item.isActive ? '停用' : '启用'}</button></div></td>
  </tr>;
}

export default function SystemDictionariesPage() {
  const user = useAuthStore((state) => state.user);
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [dictionaryCode, setDictionaryCode] = useState('');
  const [dictionaryCodeTouched, setDictionaryCodeTouched] = useState(false);
  const [dictionaryName, setDictionaryName] = useState('');
  const [dictionaryDescription, setDictionaryDescription] = useState('');
  const [itemCode, setItemCode] = useState('');
  const [itemCodeTouched, setItemCodeTouched] = useState(false);
  const [itemName, setItemName] = useState('');
  const [itemDescription, setItemDescription] = useState('');
  const [itemSortOrder, setItemSortOrder] = useState('0');
  const dictionariesQuery = useQuery({ queryKey: ['system-dictionaries'], queryFn: () => api.get<Dictionary[]>('/system-management/dictionaries') });
  const dictionaries = dictionariesQuery.data ?? [];
  const activeDictionaries = dictionaries.filter((dictionary) => dictionary.isActive);
  const selected = useMemo(() => dictionaries.find((dictionary) => dictionary.id === selectedId) ?? dictionaries[0] ?? null, [dictionaries, selectedId]);
  useEffect(() => { if (selected && selected.id !== selectedId) setSelectedId(selected.id); }, [selected, selectedId]);
  useEffect(() => { setItemCode(''); setItemCodeTouched(false); setItemName(''); setItemDescription(''); setItemSortOrder('0'); }, [selected?.id]);
  const refresh = async () => { await queryClient.invalidateQueries({ queryKey: ['system-dictionaries'] }); };
  const createDictionary = useMutation({ mutationFn: () => api.post<Dictionary>('/system-management/dictionaries', { code: dictionaryCode, name: dictionaryName, description: dictionaryDescription || null }), onSuccess: async (row) => { setDictionaryCode(''); setDictionaryCodeTouched(false); setDictionaryName(''); setDictionaryDescription(''); setSelectedId(row.id); setNotice('字典分类已创建'); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const patchDictionary = useMutation({ mutationFn: (input: { id: string; name?: string; description?: string | null; isActive?: boolean }) => api.patch<Dictionary>(`/system-management/dictionaries/${input.id}`, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) }), onSuccess: async () => { setNotice('字典分类已更新'); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const createItem = useMutation({ mutationFn: () => { if (!selected) throw new Error('请先选择字典分类'); return api.post<DictionaryItem>(`/system-management/dictionaries/${selected.id}/items`, { code: itemCode, name: itemName, description: itemDescription || null, sortOrder: Number(itemSortOrder) }); }, onSuccess: async () => { setItemCode(''); setItemCodeTouched(false); setItemName(''); setItemDescription(''); setItemSortOrder('0'); setNotice('字典项已新增'); await refresh(); }, onError: (error) => setNotice((error as Error).message) });
  const patchItem = useMutation({ mutationFn: (input: { id: string; name?: string; description?: string | null; sortOrder?: number; isActive?: boolean }) => api.patch<DictionaryItem>(`/system-management/dictionary-items/${input.id}`, { ...(input.name !== undefined ? { name: input.name } : {}), ...(input.description !== undefined ? { description: input.description } : {}), ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) }), onSuccess: async () => { setNotice('字典项已更新'); await refresh(); }, onError: (error) => setNotice((error as Error).message) });

  if (user?.role !== 'ADMIN') return <Navigate to="/" replace />;
  if (dictionariesQuery.isLoading) return <div className="page-wrap"><LoadingBlock label="正在读取统一基础字典…" /></div>;
  if (dictionariesQuery.error) return <div className="page-wrap"><ErrorBlock message={(dictionariesQuery.error as Error).message} retry={() => { void dictionariesQuery.refetch(); }} /></div>;

  return <div className="page-wrap system-expansion-page system-config-page">
    <PageHeader eyebrow="SYSTEM MANAGEMENT / DICTIONARIES" title="统一基础字典" subtitle="集中维护跨业务模块可复用的分类与选项。编码创建后保持稳定；停用只影响后续选择，不删除历史记录。合同金额、结算状态等核心财务枚举不会被动态字典直接覆盖。" actions={<button type="button" className="panel-header-action" onClick={() => { void dictionariesQuery.refetch(); }}><RefreshCw size={14} />刷新</button>} />
    {notice && <div className="system-expansion-notice" role="status"><CheckCircle2 size={16} /><span>{notice}</span><button type="button" onClick={() => setNotice('')} aria-label="关闭提示">×</button></div>}

    <section className="panel system-expansion-section">
      <div className="panel-heading"><div><h3><Plus size={17} />新建字典分类</h3><p>编码用于程序和数据关联，建议使用稳定的大写英文编码；名称用于界面显示。</p></div><span className="system-overview-readiness-tag">{dictionaries.length} 个分类 · {activeDictionaries.length} 个启用</span></div>
      <form className="system-expansion-form system-config-create-form" onSubmit={(event) => { event.preventDefault(); createDictionary.mutate(); }}>
        <label><span>分类名称</span><input value={dictionaryName} onChange={(event) => { const next = event.target.value; setDictionaryName(next); if (!dictionaryCodeTouched) setDictionaryCode(suggestCodeFromName(next, 80)); }} required maxLength={120} placeholder="如 项目资料分类" /></label>
        <label><span>分类编码</span><input value={dictionaryCode} onChange={(event) => { setDictionaryCode(event.target.value.toUpperCase()); setDictionaryCodeTouched(true); }} required maxLength={80} pattern="[A-Z][A-Z0-9_]{1,79}" placeholder="根据分类名称自动推荐" /><small className="system-code-suggestion">名称输入后自动推荐，可手动修改</small></label>
        <label><span>用途说明</span><input value={dictionaryDescription} onChange={(event) => setDictionaryDescription(event.target.value)} maxLength={1000} placeholder="说明什么场景使用该分类" /></label>
        <button type="submit" className="button-primary" disabled={createDictionary.isPending}><Plus size={14} />创建分类</button>
      </form>
    </section>

    <div className="system-dictionary-layout">
      <section className="panel system-expansion-section system-dictionary-catalog">
        <div className="panel-heading"><div><h3>字典目录</h3><p>选择分类维护其可用选项。</p></div></div>
        {dictionaries.length ? <div className="system-dictionary-card-list">{dictionaries.map((dictionary) => <DictionaryCard key={dictionary.id} dictionary={dictionary} selected={selected?.id === dictionary.id} onSelect={() => setSelectedId(dictionary.id)} onPatch={(input) => patchDictionary.mutate(input)} saving={patchDictionary.isPending} />)}</div> : <div className="system-config-empty">尚无字典分类。</div>}
      </section>

      <section className="panel system-expansion-section system-dictionary-detail">
        {selected ? <>
          <div className="panel-heading"><div><h3>{selected.name} <small className="system-config-code">{selected.code}</small></h3><p>{selected.description || '暂无用途说明'} · {selected.isSystem ? '系统内置分类' : '自定义分类'}</p></div><span className="system-overview-readiness-tag">{selected.items.length} 个字典项</span></div>
          <form className="system-expansion-form system-dictionary-item-create" onSubmit={(event) => { event.preventDefault(); createItem.mutate(); }}>
            <label><span>显示名称</span><input value={itemName} onChange={(event) => { const next = event.target.value; setItemName(next); if (!itemCodeTouched) setItemCode(suggestCodeFromName(next, 80)); }} required maxLength={120} placeholder="如 其他" /></label>
            <label><span>选项编码</span><input value={itemCode} onChange={(event) => { setItemCode(event.target.value.toUpperCase()); setItemCodeTouched(true); }} required maxLength={80} pattern="[A-Z][A-Z0-9_]{1,79}" placeholder="根据显示名称自动推荐" /><small className="system-code-suggestion">名称输入后自动推荐，可手动修改</small></label>
            <label><span>说明</span><input value={itemDescription} onChange={(event) => setItemDescription(event.target.value)} maxLength={1000} placeholder="选项说明（可选）" /></label>
            <label><span>排序</span><input type="number" value={itemSortOrder} onChange={(event) => setItemSortOrder(event.target.value)} min={-100000} max={100000} required /></label>
            <button type="submit" className="button-primary" disabled={!selected.isActive || createItem.isPending || !Number.isInteger(Number(itemSortOrder))}><Plus size={14} />新增选项</button>
          </form>
          {!selected.isActive && <div className="system-config-callout">此分类已停用，暂时不能新增字典项。重新启用后可继续维护。</div>}
          <div className="table-scroll"><table className="data-table system-expansion-table system-config-items-table"><thead><tr><th>稳定编码</th><th>显示名称</th><th>说明</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>{selected.items.map((item) => <DictionaryItemRow key={item.id} item={item} onPatch={(input) => patchItem.mutate(input)} saving={patchItem.isPending} />)}</tbody></table></div>
          {!selected.items.length && <div className="system-config-empty">此分类暂无字典项，可使用上方表单添加。</div>}
        </> : <div className="system-config-empty">请先选择或创建一个字典分类。</div>}
      </section>
    </div>
    <div className="data-note"><span className="note-mark">i</span><span>系统通过软停用保留历史编码。字典项的创建、名称/排序调整和启停均写入操作审计。现有财务状态机及类型化字段不会因维护字典而自动变更，业务字段接入字典将按模块单独迁移与验收。</span></div>
  </div>;
}
