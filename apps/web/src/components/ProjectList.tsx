import { useState, useMemo, useRef, useCallback } from 'react';
import { Plus, Search, X, Pin, PinOff, ChevronRight } from 'lucide-react';
import type { Project, ProjectStatus } from '../types';
import { SectionTitle, SortTrigger, SortMenu, type SortMode, type DisplayMode } from './SortMenu';

/* ============================================================
   项目列表（对齐 hana 会话列表）
   ============================================================
   hana 会话行的真实结构（CardShell-B3PSoerL.css + JSX）：

     ._sessionItem        flex-direction: COLUMN
                          padding: 6px 8px
                          margin-bottom: 1px
                          border-radius: radius-sm × squircle
       ├─ ._sessionItemHeader   标题行（flex row）
       │    ├─ ._sessionItemLead    左侧标识（agent 头像/星标），flex: 0 0 auto
       │    ├─ ._sessionItemTitle   标题，font-size --fs-ui (13px)，line-height 1.4
       │    └─ ._sessionItemActions 右侧操作，absolute right 4px，默认 opacity 0
       └─ ._sessionItemMeta     元信息，font-size --fs-hint (11.2px)，opacity .8

   关键：标题与元信息是「上下两行」，不是「左图标 + 右文字」的横向排列。
   我第一版做成了横向，这是与 hana 最大的结构差异。
   ============================================================ */

/* 项目状态的中文标签（对齐 ProjectStatus 枚举） */
const STATUS_LABELS: Record<string, string> = {
  CONSTRUCTION: '在建',
  SETTLEMENT_PENDING: '待结算',
  SETTLED: '已结算',
  PAUSED: '暂停',
};

export type ProjectListProps = {
  projects: Project[];
  loading: boolean;
  selectedProjectId: string | null;
  onSelect: (id: string) => void;
  onManage: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  pinnedIds: string[];
  onTogglePin: (id: string) => void;
  onReorder?: (draggedId: string, targetId: string) => void;
  limit?: number;
  sort: SortMode;
  display: DisplayMode;
  onSortChange: (mode: SortMode) => void;
  onDisplayChange: (mode: DisplayMode) => void;
};

export function ProjectList({
  projects, loading, selectedProjectId, onSelect, onManage,
  search, onSearchChange, pinnedIds, onTogglePin,
  limit, sort, display, onSortChange, onDisplayChange,
}: ProjectListProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);

  /* 分组：只做两种（不设「按最近」模式）
       ① sort === 'time'   → 按 startDate 分「本年 / 去年 / 更早」
       ② sort === 'status' → 按项目状态分，在建排最前

     hana 的时间分组是 today/thisWeek/earlier（会话场景），
     moheng 是工程项目，时间粒度按年更合理。 */
  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const match = (p: Project) => !q
      || p.name.toLowerCase().includes(q)
      || (p.code ?? '').toLowerCase().includes(q);

    const list = projects.filter(match);
    const pinned = list.filter((p) => pinnedSet.has(p.id));
    const rest = list.filter((p) => !pinnedSet.has(p.id));

    pinned.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

    if (sort === 'status') {
      /* 状态分组：在建排最前，顺序 = 在建 → 待结算 → 暂停 → 已结算 */
      const ORDER: ProjectStatus[] = ['CONSTRUCTION', 'SETTLEMENT_PENDING', 'PAUSED', 'SETTLED'];
      const groups = ORDER
        .map((status) => ({
          key: status,
          label: STATUS_LABELS[status] ?? status,
          items: rest.filter((p) => p.status === status)
            .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
        }))
        .filter((g) => g.items.length > 0);
      return { pinned, rest, groups };
    }

    /* sort === 'time'：按开工年份分本年 / 去年 / 更早 */
    const thisYear = new Date().getFullYear();
    const yearOf = (p: Project) => {
      const t = p.startDate ? new Date(p.startDate).getTime() : 0;
      return t ? new Date(t).getFullYear() : 0;
    };

    const groups = [
      { key: 'thisYear', label: '本年', match: (p: Project) => yearOf(p) === thisYear },
      { key: 'lastYear', label: '去年', match: (p: Project) => yearOf(p) === thisYear - 1 },
      { key: 'earlier', label: '更早', match: (p: Project) => yearOf(p) < thisYear - 1 || yearOf(p) === 0 },
    ]
      .map((g) => ({
        key: g.key,
        label: g.label,
        items: rest.filter(g.match).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
      }))
      .filter((g) => g.items.length > 0);

    return { pinned, rest, groups };
  }, [projects, pinnedSet, search, sort]);

  const openSort = useCallback((el: HTMLElement) => {
    setSortAnchor(el);
    setSortOpen((v) => !v);
  }, []);

  /* 列表头操作按钮：管理项目 + 排序与显示。
     对齐 hana：这两个按钮在 _sectionTitleActions 里，
     默认 opacity 0，悬停滚动区时显现。 */
  const ACTIONS = (
    <>
      <button
        type="button"
        className="sidebar-section-icon-button"
        aria-label="管理项目"
        title="管理项目"
        onClick={onManage}
      >
        <Plus size={13} />
      </button>
      <SortTrigger onClick={openSort} open={sortOpen} />
    </>
  );


  const closeSort = useCallback(() => setSortOpen(false), []);

  const renderRow = (project: Project, isPinned: boolean) => {
    const active = selectedProjectId === project.id;
    return (
      <div
        key={project.id}
        className={`sidebar-project-row${active ? ' is-active' : ''}${display === 'single-line' ? ' is-single-line' : ''}`}
      >
        <button
          type="button"
          className="sidebar-project"
          onClick={() => onSelect(project.id)}
          aria-pressed={active}
          title={`${project.name}${project.code ? ` · ${project.code}` : ''}`}
        >
          {/* 标题行：lead（首字方块）+ 标题。用户要求保留首字方块。 */}
          <span className="sidebar-project-header">
            <span className="sidebar-project-lead" aria-hidden="true">{project.name.slice(0, 1)}</span>
            <span className="sidebar-project-title">{project.name}</span>
          </span>
          {/* 元信息行：编码 · 状态（对齐 hana ._sessionItemMeta 的 " · " 分隔） */}
          <span className="sidebar-project-meta">
            <span>{project.code || '未编号'}</span>
            {project.status && (
              <>
                <span className="sidebar-project-meta-dot" aria-hidden="true" />
                <span>{STATUS_LABELS[project.status] ?? project.status}</span>
              </>
            )}
          </span>
        </button>

        {/* 操作区：绝对定位右侧，默认隐藏 */}
        <div className="sidebar-project-actions">
          <button
            type="button"
            className="sidebar-project-pin"
            onClick={(event) => { event.stopPropagation(); onTogglePin(project.id); }}
            aria-label={isPinned ? `取消置顶 ${project.name}` : `置顶 ${project.name}`}
            data-pinned={isPinned || undefined}
            title={isPinned ? '取消置顶' : '置顶'}
          >
            {isPinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>
      </div>
    );
  };

  /* 时间排序时 restTotal 来自分组求和；其他排序直接取 rest.length。 */
  const restTotal = grouped.groups.length > 0
    ? grouped.groups.reduce((sum, g) => sum + g.items.length, 0)
    : grouped.rest.length;
  const total = grouped.pinned.length + restTotal;
  const visibleCount = limit ? Math.min(limit, total) : total;

  /* 剩余可展示的额度（limit 模式下，置顶优先占位） */
  let remaining = limit ? Math.max(0, limit - grouped.pinned.length) : Number.POSITIVE_INFINITY;

  return (
    <section className="sidebar-projects" aria-label="项目列表">
      {/* 系统分隔线：对齐 hana ._fpSystemDivider_8f4fe
          位置：功能按钮区之后、会话列表（搜索框）之前。
          规格：width 72%、height 1px、margin 4px auto、text-muted 18% */}
      <div className="sidebar-system-divider" data-fp-system-divider aria-hidden="true" />

      {/* 搜索框：对齐 hana 侧栏内的 ._sessionSearchBox（无 ::before 线，margin 6px） */}
      <div className="sidebar-project-search">
        <Search size={14} className="sidebar-project-search-icon" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          className="sidebar-project-search-input"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="搜索项目"
          aria-label="搜索项目"
        />
        {search && (
          <button
            type="button"
            className="sidebar-project-search-clear"
            onClick={() => { onSearchChange(''); searchRef.current?.focus(); }}
            aria-label="清除搜索"
          >
            <X size={12} />
          </button>
        )}
      </div>

      <div className="sidebar-project-list" role="list">
        {loading && <div className="sidebar-project-empty">正在加载项目…</div>}
        {!loading && total === 0 && (
          <div className="sidebar-project-empty">
            {search ? '没有匹配的项目' : '暂无可访问项目'}
          </div>
        )}

        {/* 置顶区：无标题标签（hana 的 pinnedSection 只有 aria-label） */}
        {grouped.pinned.length > 0 && (
          <div className="sidebar-project-pinned" role="group" aria-label="置顶">
            {grouped.pinned.map((project) => renderRow(project, true))}
          </div>
        )}
        {grouped.pinned.length > 0 && total > grouped.pinned.length && (
          <div className="sidebar-project-divider" aria-hidden="true" />
        )}

        {/* 时间分组：sort === 'time' 时按 今天/本周/更早 分组（对齐 hana obe 数组） */}
        {grouped.groups.map((group, groupIndex) => {
          if (remaining <= 0) return null;
          const items = group.items.slice(0, remaining);
          remaining -= items.length;
          return (
            <div className="sidebar-project-group" key={group.key}>
              {/* 只有第一个分组标题带操作按钮（对齐 hana：操作区属于列表头部，
                  不属于每个分组）。按钮与「本年」这类标题同行。 */}
              {groupIndex === 0
                ? <SectionTitle actions={ACTIONS}>{<span>{group.label}</span>}</SectionTitle>
                : <SectionTitle><span>{group.label}</span></SectionTitle>}
              {items.map((project) => renderRow(project, false))}
            </div>
          );
        })}

        {/* 非时间排序（project / recent）：不分组，平铺剩余项目 */}
        {grouped.groups.length === 0 && grouped.rest.length > 0 && (
          <>
            <SectionTitle actions={ACTIONS}><span>项目</span></SectionTitle>
            {grouped.rest.slice(0, limit ? Math.max(0, limit - grouped.pinned.length) : undefined)
              .map((project) => renderRow(project, false))}
          </>
        )}
      </div>

      {limit && total > visibleCount && (
        <button type="button" className="sidebar-project-all" onClick={onManage}>
          查看全部 {total} 个项目<ChevronRight size={11} />
        </button>
      )}

      {sortOpen && (
        <SortMenu
          sort={sort}
          display={display}
          onSortChange={onSortChange}
          onDisplayChange={onDisplayChange}
          anchor={sortAnchor}
          onClose={closeSort}
        />
      )}
    </section>
  );
}
