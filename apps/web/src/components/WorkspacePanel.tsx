/**
 * 项目工作区右侧面板。
 *
 * 结构对齐 hana 的 _previewPanel：
 *
 *   .workspace-panel           580px
 *     ├─ .workspace-card-main  文件卡片
 *     │    ├─ 标签栏（对话文件 / 工作室）
 *     │    ├─ 搜索框 30px
 *     │    └─ 目录树 / 文件列表
 *     └─ .workspace-card-studio 预览卡（暖米色，40px / 320px）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowUpDown, ChevronLeft, ChevronRight, Download, Eye, Filter, Plus, RefreshCw,
  Trash2, Upload, X,
} from 'lucide-react';

import { api } from '../api';
import { useAuthStore, useUiStore } from '../auth-store';
import { FileKindIcon, FolderKindIcon, kindFromExt } from './FileKindIcon';
import { usePreviewPanelResize } from '../lib/use-preview-panel-resize';
import { visibleCards } from '../lib/workspace-cards';
import { useTitlebarClearance } from '../lib/use-titlebar-clearance';
import { CardSplitHandle } from './CardSplitHandle';
import { PreviewNewTabChooser } from './PreviewNewTabChooser';
import { PreviewTabBar } from './PreviewTabBar';
import PaperTextureLayer from './PaperTextureLayer';

export type WorkspaceEntry = {
  name: string;
  path: string;
  /** 对齐 Hana 的 isDir */
  isDir: boolean;
  /** 目录为 null */
  size: number | null;
  mtime: string;
  ext?: string;
  hasChildren?: boolean;
};

/** 项目产物（对话文件标签的数据源） */
export type ProjectArtifact = {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  ext: string;
  uploadedAt: string;
  sourceKind: 'change-evidence';
  sourceCode: string;
  sourceName: string;
  sourceId: string;
  evidenceClass?: string | null;
};

/** 对话文件页的排序标签：对齐 hana 的 MQ(Z) ——
    hana 的四档是 time-desc / name-asc / name-desc / type-asc，
    moheng 只有三个可用维度（时间 / 名称 / 大小）。 */
const ARTIFACT_SORT_LABEL = { time: '时间', name: '名称', size: '大小' } as const;

/** 工作区排序选项：对齐 hana 的 OJe()（localStorage key `hana-desk-sort`） */
const DESK_SORT_OPTIONS = [
  { id: 'name', label: '名称' },
  { id: 'mtime', label: '修改时间' },
  { id: 'size', label: '大小' },
] as const;
const DESK_SORT_LABEL = Object.fromEntries(
  DESK_SORT_OPTIONS.map((o) => [o.id, o.label]),
) as Record<(typeof DESK_SORT_OPTIONS)[number]['id'], string>;

/**
 * 预览标签项。对齐 hana 的 previewItem：
 *   hana 的 item 有 id / type / title / ext / content …
 *   moheng 只有两种来源：工作区文件（workspace）与项目产物（artifact）。
 *   type 枚举也跟着分两类。
 */
type PreviewTabMeta = {
  /** 唯一 id：workspace 用 path，artifact 用 artifactId */
  id: string;
  source: 'workspace' | 'artifact';
  title: string;
  /** 文件扩展名（含点），用于图标与渲染分支 */
  ext: string;
  /** workspace 源：条目 */
  entry?: WorkspaceEntry;
  /** artifact 源：产物 */
  artifact?: ProjectArtifact;
};

type Props = {
  /** 不传则从全局 store 取（Layout 里的应用级浮层用法） */
  projectId?: string;
  projectName?: string;
  onClose?: () => void;
};

/** 扩展名 → 图标 */
function iconFor(entry: WorkspaceEntry) {
  if (entry.isDir) return Folder;
  const ext = entry.ext ?? '';
  if (/^\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(ext)) return FileImage;
  if (/^\.(xlsx|xls|csv)$/.test(ext)) return FileSpreadsheet;
  if (/^\.(txt|md|json|log|xml|html)$/.test(ext)) return FileText;
  return File;
}

/** 人类可读大小 */
function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 人类可读时间（对齐 hana 的 _fileMeta 时间格式：月/日 时:分） */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 判断能否内嵌预览 */
function previewKind(ext?: string): 'pdf' | 'image' | 'text' | 'none' {
  const e = ext ?? '';
  if (e === '.pdf') return 'pdf';
  if (/^\.(png|jpg|jpeg|webp|gif|bmp)$/.test(e)) return 'image';
  if (/^\.(txt|md|json|log|xml|csv)$/.test(e)) return 'text';
  return 'none';
}

export function WorkspacePanel(props: Props = {}) {
  const queryClient = useQueryClient();
  const accessToken = useAuthStore((state) => state.accessToken);
  const storeProjectId = useUiStore((state) => state.selectedProjectId);
  const workspaceOpen = useUiStore((state) => state.workspaceOpen);
  const setWorkspaceOpen = useUiStore((state) => state.setWorkspaceOpen);

  // 所有 hooks 必须在这两个提前 return 之前 ——
  // 否则展开/收起时 hooks 数量会变化，React 报
  // "Rendered more hooks than during the previous render"。
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<WorkspaceEntry | null>(null);
  /** 多标签预览：对齐 hana 的 openTabs + activeTabId。
      hana 状态：Tee（openTabs 数组）、Xf（activeTabId）、x4（预览项表）。
      moheng 用同构的两份：
        previewTabs  —— 已打开的预览项（文件 / 产物 / 空态占位）
        activeTabId  —— 当前激活的 tab
      初始只有一张「new-tab」空态（对齐 hana 没有 open tabs 时渲染 RDe → zq）。 */
  const [previewTabs, setPreviewTabs] = useState<PreviewTabMeta[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  /** 上下两卡高度比（0~1）。对齐 hana 的 layout group rowRatios，
      默认 0.5 = 平分。 */
  const [cardSplitRatio, setCardSplitRatio] = useState(0.5);

  /** 打开一个预览标签。对齐 hana 的 Hy(tabId)：同一 id 已开则只激活，不重复插入。 */
  const openPreviewTab = useCallback((tab: PreviewTabMeta) => {
    setPreviewTabs((prev) => {
      const exists = prev.some((item) => item.id === tab.id);
      return exists ? prev : [...prev, tab];
    });
    setActiveTabId(tab.id);
  }, []);

  /** 关闭一个标签。对齐 hana 的 gg(id)：
      关掉后若当前激活的就是它，则激活左邻（没有就右邻），全空则置 null。 */
  const closePreviewTab = useCallback((id: string) => {
    setPreviewTabs((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      const next = prev.filter((item) => item.id !== id);
      setActiveTabId((current) => {
        if (current !== id) return current;
        if (next.length === 0) return null;
        return next[Math.min(index, next.length - 1)]?.id ?? null;
      });
      return next;
    });
  }, []);

  /** 把工作区条目开成标签 */
  const openEntryTab = useCallback((entry: WorkspaceEntry) => {
    const ext = entry.name.slice(entry.name.lastIndexOf('.'));
    openPreviewTab({ id: `ws:${entry.path}`, source: 'workspace', title: entry.name, ext, entry });
  }, [openPreviewTab]);

  /** 把产物开成标签 */
  const openArtifactTab = useCallback((artifact: ProjectArtifact) => {
    openPreviewTab({
      id: `art:${artifact.id}`,
      source: 'artifact',
      title: artifact.name,
      ext: artifact.ext || artifact.name.slice(artifact.name.lastIndexOf('.')),
      artifact,
    });
  }, [openPreviewTab]);

  /** 多选集合（对齐 hana 的 selectedIds Set）。单击清空，metaKey 切换 */
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const panelResize = usePreviewPanelResize();
  /** 工作区卡头也要让位：窗口控制区压在面板右上角时，卡头右侧让开 */
  const panelRef = useRef<HTMLElement>(null);
  /** 每张卡自己测让位 —— 对齐 hana 的 Sot：
      它是在 tileShell 组件内部调用的，A 是**这张卡片自己**的 ref。
      所以预览卡在文件卡下方、不与窗口控制区重叠时，让位量就是 null（不让位）。
      之前我把测量加在 panel 上，两张卡吃了同一份让位量，这是错的。 */
  const filesCardRef = useRef<HTMLElement>(null);
  const previewCardRef = useRef<HTMLElement>(null);
  const filesClearance = useTitlebarClearance(filesCardRef, workspaceOpen);
  const previewClearance = useTitlebarClearance(previewCardRef, workspaceOpen);
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [lastDir, setLastDir] = useState('');
  /** 工作区标签页：对话文件 / 工作室。对齐 hana 的 session-files / workspace */
  /** 工具条状态：预览开关、筛选菜单、排序菜单 */
  const [showPreviewToggle, setShowPreviewToggle] = useState(true);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  /** 排序模式：对齐 hana 的 deskSortMode */
  const [deskSortMode, setDeskSortMode] = useState<'name' | 'mtime' | 'size'>('name');
  /** 类型筛选：对齐 hana 的 deskTypeFilters（image / text / video） */
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set());
  /** 对话文件页的排序：对齐 hana 的 K = ["time-desc", "name-asc", "name-desc", "type-asc"] */
  const [artifactSort, setArtifactSort] = useState<'time' | 'name' | 'size'>('time');
  const [artifactSortOpen, setArtifactSortOpen] = useState(false);
  /** 标签：从 uiStore 读，因为顶栏的两个面板开关也要切它 */
  const workspaceTab = useUiStore((state) => state.workspaceTab);
  const setWorkspaceTab = useUiStore((state) => state.setWorkspaceTab);

  /** 内层目录：对齐 hana 的 data-inner 两态。
      hana 的 inner 由 mountId !== null 决定（是否已进入某个挂载点）。
      moheng 只有一个项目目录，所以：进入工作室先看到「挂载点列表」（外层），
      点一行才进入目录树（内层）。null = 外层，'' = 内层根目录。 */
  const [enteredDir, setEnteredDir] = useState<string | null>(null);
  const innerDir = workspaceTab === 'studio' ? enteredDir : null;

  /* 切到工作室 tab 时回到外层（对齐 hana：切换 tab 不保留 inner） */
  useEffect(() => {
    if (workspaceTab !== 'studio') setEnteredDir(null);
  }, [workspaceTab]);
  /** 抽屉开关：项目文件目录入口（对齐 hana 的 jianDrawerOpen） */
  const [jianOpen, setJianOpen] = useState(false);



  /* 卡片定义表（对齐 hana 的 visibleWhen）：
     预览卡只在有选中项时出现，没有内容就不占空间。 */
  /* 预览卡由 showPreviewToggle 控制 —— 对齐 hana：
     卡头 × 与标签栏的收起按钮都收起整张预览卡（不是清空标签）。 */
  const hasSelection = showPreviewToggle;
  const cards = visibleCards({ hasSelection, tab: workspaceTab });
  const showPreview = cards.some((card) => card.id === 'preview');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const projectId = props.projectId ?? storeProjectId ?? '';

  /**
   * 「打开文件」选中的本地文件。
   * hana 的路径是 Ij(files, { openSink })：文件先落到会话产物，再开成 tab。
   * moheng 没有会话产物那一层，所以先把文件传到当前项目的工作区，再开标签。
   * 上传失败时给提示，不静默失败。
   */
  const handlePreviewPickFiles = useCallback(async (files: FileList) => {
    if (!projectId) return;
    for (const file of Array.from(files)) {
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
          reader.onload = () => {
            const result = String(reader.result ?? '');
            resolve(result.includes(',') ? (result.split(',').pop() ?? '') : result);
          };
          reader.readAsDataURL(file);
        });
        const response = await fetch(`/api/projects/${projectId}/workspace/file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ dir: lastDir ?? '', fileName: file.name, contentBase64: base64 }),
        });
        if (!response.ok) throw new Error(`上传失败（${response.status}）`);
        const payload = (await response.json()) as { data?: { path?: string } };
        const path = payload.data?.path ?? file.name;
        openPreviewTab({
          id: `ws:${path}`,
          source: 'workspace',
          title: file.name,
          ext: file.name.slice(file.name.lastIndexOf('.')),
          entry: {
            name: file.name,
            path,
            isDir: false,
            size: file.size,
            ext: file.name.slice(file.name.lastIndexOf('.')).replace(/^\./, ''),
            modifiedAt: new Date().toISOString(),
          } as WorkspaceEntry,
        });
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '文件上传失败');
      }
    }
    void queryClient.invalidateQueries({ queryKey: ['workspace-tree', projectId] });
  }, [projectId, accessToken, lastDir, openPreviewTab, queryClient]);

  // 浮层模式下从项目列表取项目名（Layout 不传 projectName）
  const projectsQuery = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/projects'),
    enabled: Boolean(projectId) && !props.projectName,
  });
  const projectName = props.projectName
    ?? projectsQuery.data?.find((p) => p.id === projectId)?.name
    ?? '';

  // 没传 onClose 时用全局开关（应用级浮层）
  const onClose = props.onClose ?? (() => setWorkspaceOpen(false));

  // 应用级用法：不展开就不渲染（放在所有 hooks 之后）
  const isStandalone = props.projectId === undefined;
  const hidden = isStandalone && (!workspaceOpen || !projectId);

  // 切项目时重置本地状态
  useEffect(() => {
    setExpanded(new Set());
    setSelected(null);
    setSearch('');
    setNotice('');
    setLastDir('');
  }, [projectId]);

  const treeQuery = useQuery({
    queryKey: ['workspace-tree', projectId],
    queryFn: () => api.get<{ path: string; entries: WorkspaceEntry[] }>(`/projects/${projectId}/workspace/tree?path=`),
    // projectId 为空时不能发请求（会变成 /projects//workspace/tree 404）
    enabled: Boolean(projectId),
  });

  /** 项目产物（对话文件标签）：变更单外部凭证附件 */
  const artifactsQuery = useQuery({
    queryKey: ['project-artifacts', projectId],
    queryFn: () => api.get<{ total: number; artifacts: ProjectArtifact[] }>(`/projects/${projectId}/artifacts`),
    enabled: Boolean(projectId),
  });
  const artifactsRaw = artifactsQuery.data?.artifacts ?? [];

  /* 对话文件页的排序（对齐 hana 的 K = ["time-desc", "name-asc", "name-desc", "type-asc"]） */
  const artifacts = useMemo(() => {
    const next = [...artifactsRaw];
    if (artifactSort === 'name') next.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    else if (artifactSort === 'size') next.sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
    else next.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
    return next;
  }, [artifactsRaw, artifactSort]);

  const rootEntries = treeQuery.data?.entries ?? [];

  /* 筛选 + 排序（对齐 hana 的 deskTypeFilters / deskSortMode）：
       筛选：按文件类型（图片 / 文本 / 视频）
       排序：按名称 / 修改时间 / 大小 */
  const filteredEntries = useMemo(() => {
    const extOf = (e: WorkspaceEntry) => (e.ext ?? '').toLowerCase().replace(/^\./, '');
    const kindOf = (e: WorkspaceEntry): string => {
      const x = extOf(e);
      if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'].includes(x)) return 'image';
      if (['mp4', 'webm', 'mov', 'avi', 'mkv'].includes(x)) return 'video';
      if (['txt', 'md', 'json', 'csv', 'log', 'xml', 'yaml', 'yml'].includes(x)) return 'text';
      return 'other';
    };

    let list = rootEntries;
    if (typeFilters.size > 0) {
      list = list.filter((e) => e.isDir || typeFilters.has(kindOf(e)));
    }

    return [...list].sort((a, b) => {
      // 目录永远在前
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      if (deskSortMode === 'mtime') return (b.mtime ?? '').localeCompare(a.mtime ?? '');
      if (deskSortMode === 'size') return (b.size ?? 0) - (a.size ?? 0);
      return a.name.localeCompare(b.name, 'zh-CN');
    });
  }, [rootEntries, typeFilters, deskSortMode]);

  /** 刷新整棵树（上传/删除后调用） */
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['workspace-tree', projectId] });
  }, [queryClient, projectId]);

  /** 上传目标目录：优先最后展开的文件夹，其次选中文件所在目录 */
  const uploadDir = useMemo(() => {
    if (lastDir) return lastDir;
    if (selected && !selected.isDir) {
      const idx = selected.path.lastIndexOf('/');
      return idx >= 0 ? selected.path.slice(0, idx) : '';
    }
    return '';
  }, [lastDir, selected]);

  async function handleUpload(files: FileList | null) {
    if (!files?.length) return;
    setNotice('');

    // 先全部读成 base64，再一次性提交 —— 对齐 Hana 的批量上传。
    // 单个失败不中断整批，后端返回逐项结果。
    const payload: Array<{ name: string; contentBase64: string }> = [];
    const readFailed: string[] = [];
    for (const file of Array.from(files)) {
      try {
        payload.push({ name: file.name, contentBase64: await readAsBase64(file) });
      } catch {
        readFailed.push(file.name);
      }
    }

    if (payload.length) {
      try {
        const result = await api.post<{ ok: boolean; results: Array<{ name: string; ok: boolean; error?: string }> }>(
          `/projects/${projectId}/workspace/upload`,
          { dir: uploadDir, files: payload },
        );
        const failed = result.results.filter((r) => !r.ok);
        if (failed.length) {
          setNotice(`${failed.length} 个文件未能上传：${failed.map((r) => r.name).join('、')}`);
        }
      } catch (error) {
        setNotice(error instanceof Error ? error.message : '上传失败');
      }
    }

    if (readFailed.length) {
      setNotice((prev) => `${prev}${prev ? '；' : ''}读取失败：${readFailed.join('、')}`);
    }

    refresh();
    if (uploadDir) setExpanded((prev) => new Set(prev).add(uploadDir));
  }

  async function handleDelete(entry: WorkspaceEntry) {
    if (!window.confirm(`确定删除「${entry.name}」${entry.isDir ? '及其中全部内容' : ''}？`)) return;
    try {
      await api.delete(`/projects/${projectId}/workspace/entry?path=${encodeURIComponent(entry.path)}`);
      if (selected?.path === entry.path) setSelected(null);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '删除失败');
    }
  }

  if (hidden) return null;

  const projectLabel = projectName || '工作区';

  return (
    <aside
      className="workspace-panel"
      aria-label={`${projectLabel}工作区`}
      data-resizing={panelResize.resizing || undefined}
      ref={panelRef}
    >
      {/* 纸纹层：对齐 hana 的 Nr 组件 ——
          <div className={tray}><Hd />{trayHeader}{cardStack}</div>
          它是 tray 的第一个子元素，z-index: --z-under（-1）在内容下方。 */}
      <PaperTextureLayer />
      {/* 拖动宽度把手：对齐 hana 的 resize-handle-left ——
          位置在面板左缘，8px 热区，hover 时显现 3×44px 的 accent 条。
          hana 有 id="previewResizeHandle" 但无 JS 绑定（死代码），这里接上。 */}
      <div
        className="workspace-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整工作区宽度"
        aria-valuenow={panelResize.width}
        aria-valuemin={320}
        aria-valuemax={900}
        tabIndex={0}
        onPointerDown={panelResize.startResize}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') { event.preventDefault(); panelResize.nudgeWidth(8); }
          if (event.key === 'ArrowRight') { event.preventDefault(); panelResize.nudgeWidth(-8); }
          if (event.key === 'Home') { event.preventDefault(); panelResize.resetWidth(); }
        }}
      />
      {/* 卡片栈：对齐 hana 的 ._cardStack_09a29 ——
          flex column 纵向平铺，卡片间 6px，两张卡 flex: 1 平分高度。 */}
        {/* 两张卡片直接作为 panel 的子元素（flex column）——
            对齐 hana 的 _canvas_4bffb > _tileShell_3a897：
            卡片外壳就是 _tileShell，**外面没有容器**。 */}
      {/* 卡片一：文件。对齐 hana 的 Ket ——
          workspaceCardSurface（卡外壳，flex column）
            ├─ workspaceCardMain（卡头 + tab 栏 + 内容）
            └─ workspaceDrawerStack（抽屉栈，在下方） */}
      {/* 两张卡的容器：对齐 hana 的 layout group ——
          display: grid；行模板用百分比（fr 会被归一化，改了比例也不变）。 */}
      <div
        className="workspace-card-grid"
        data-layout-orientation="column"
        style={{
          ['--card-split-ratio' as string]: String(cardSplitRatio),
          gridTemplateRows: showPreview
            ? `minmax(0, ${cardSplitRatio * 100}%) 6px minmax(0, ${(1 - cardSplitRatio) * 100}%)`
            : '100%',
        }}
      >
      <section
        className="workspace-card workspace-card-main"
        aria-label="文件"
        ref={filesCardRef}
        style={{ ['--ttb-clearance-right' as string]: `${filesClearance.right ?? 0}px` }}
      >
        {/* workspaceCardMain：对齐 hana 的 ._workspaceCardMain_a2a0f ——
            position: relative; display: flex; flex-direction: column; flex: 1 1 auto;
            min-height: 0。 */}
        {/* 卡头：对齐 hana 的 ._cardTop_7790b
            files 卡片 [h4] 只有 closable: true，favoritable / starable / screenshotable /
            exportable / detached 全是 false，所以卡头只有一个 ×（来自 dve 的 close）。 */}
        <div className="workspace-card-top">
          <span className="workspace-card-title">文件</span>
          <span className="workspace-card-actions">
            {onClose && (
              <button type="button" className="workspace-icon-btn" aria-label="关闭工作区" data-tooltip="关闭" onClick={onClose}>
                <X size={13} />
              </button>
            )}
          </span>
        </div>
        <div className="workspace-card-surface-main" data-workspace-card-main>
        {/* 标签栏：对齐 hana 的 _tabBar_2e5d8 + _tabs_22ed1 ——
            容器 grid 2 列、padding 2px、背景 overlay-subtle、1px overlay-light 边框；
            滑块 width: calc((100% - 6px)/2)，activeTab 决定 transform。 */}
        <div className="workspace-tab-bar">
          <div
            className="workspace-tabs"
            role="tablist"
            aria-label="工作区视图"
            style={{ ['--right-workspace-tab-slider-offset' as string]: workspaceTab === 'files' ? '0px' : 'calc(100% + 2px)' }}
          >
            <div className="workspace-tab-slider" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'files'}
              className={`workspace-tab${workspaceTab === 'files' ? ' is-active' : ''}`}
              onClick={() => setWorkspaceTab('files')}
            >对话文件</button>
            <button
              type="button"
              role="tab"
              aria-selected={workspaceTab === 'studio'}
              className={`workspace-tab${workspaceTab === 'studio' ? ' is-active' : ''}`}
              onClick={() => setWorkspaceTab('studio')}
            >工作室</button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => { void handleUpload(event.target.files); event.target.value = ''; }}
          />
        </div>

        {/* 对话文件页：只有排序按钮 —— 对齐 hana 的 RZe：
            <section data-session-files-panel>
              <div sessionFilesToolbar><Menu><button 排序按钮/></Menu></div>
              <div fileList role="list">...</div>
            </section>
            没有搜索、没有添加文件夹、没有预览开关。 */}
        {workspaceTab === 'files' && (
          <div className="workspace-files-toolbar" data-session-files-toolbar>
            <span className="workspace-files-count">{artifacts.length} 项</span>
            <div className="workspace-files-sort-wrap">
              <button
                type="button"
                className="workspace-files-sort"
                aria-label="产物排序"
                aria-expanded={artifactSortOpen}
                onClick={() => setArtifactSortOpen(!artifactSortOpen)}
              >
                <ArrowUpDown size={14} />
                <span>{ARTIFACT_SORT_LABEL[artifactSort]}</span>
              </button>
              {artifactSortOpen && (
                <div className="workspace-menu" role="menu">
                  {(['time', 'name', 'size'] as const).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="menuitemradio"
                      aria-checked={artifactSort === key}
                      className={`workspace-menu-item${artifactSort === key ? ' is-checked' : ''}`}
                      onClick={() => { setArtifactSort(key); setArtifactSortOpen(false); }}
                    >
                      {ARTIFACT_SORT_LABEL[key]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 工具条：只在「工作室」tab 渲染 ——
            对齐 hana：外层不渲染，内层（已进入目录）才渲染。 */}
        {workspaceTab === 'studio' && innerDir !== null && (
        <div className="workspace-toolbar" data-studio-desk-toolbar>
          <button
            type="button"
            className="workspace-toolbar-btn"
            aria-label={showPreviewToggle ? '隐藏预览' : '显示预览'}
            aria-pressed={showPreviewToggle}
            data-tooltip={showPreviewToggle ? '隐藏预览' : '显示预览'}
            onClick={() => setShowPreviewToggle((v) => !v)}
          >
            <Eye size={15} />
          </button>
          <div className="workspace-toolbar-actions">
            <div className="workspace-menu-wrap">
              <button
                type="button"
                className={`workspace-toolbar-btn workspace-toolbar-btn-text${typeFilters.size > 0 ? ' is-active' : ''}`}
                aria-label="筛选"
                aria-haspopup="menu"
                aria-expanded={filterMenuOpen}
                onClick={() => { setSortMenuOpen(false); setFilterMenuOpen((v) => !v); }}
              >
                <Filter size={14} />
                <span>{typeFilters.size > 0 ? `筛选 ${typeFilters.size}` : '筛选'}</span>
              </button>
              {filterMenuOpen && (
                <div className="workspace-menu" role="menu" aria-label="按类型筛选">
                  {[{ id: 'image', label: '图片' }, { id: 'text', label: '文本' }, { id: 'video', label: '视频' }].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemcheckbox"
                      aria-checked={typeFilters.has(opt.id)}
                      className="workspace-menu-item"
                      onClick={() => {
                        setTypeFilters((prev) => {
                          const next = new Set(prev);
                          if (next.has(opt.id)) next.delete(opt.id); else next.add(opt.id);
                          return next;
                        });
                      }}
                    >
                      <span className="workspace-menu-check" data-checked={typeFilters.has(opt.id) || undefined} aria-hidden="true" />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="workspace-menu-wrap">
              <button
                type="button"
                className="workspace-toolbar-btn workspace-toolbar-btn-text"
                aria-label="排序"
                aria-haspopup="menu"
                aria-expanded={sortMenuOpen}
                onClick={() => { setFilterMenuOpen(false); setSortMenuOpen((v) => !v); }}
              >
                <ArrowUpDown size={14} />
                <span>{DESK_SORT_LABEL[deskSortMode]}</span>
              </button>
              {sortMenuOpen && (
                <div className="workspace-menu" role="menu" aria-label="排序方式">
                  {DESK_SORT_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={deskSortMode === opt.id}
                      className="workspace-menu-item"
                      onClick={() => { setDeskSortMode(opt.id as typeof deskSortMode); setSortMenuOpen(false); }}
                    >
                      <span className="workspace-menu-check" data-checked={deskSortMode === opt.id || undefined} aria-hidden="true" />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        )}

          {/* chrome：只在「工作室」tab 渲染 ——
              三段：返回（chromeLead）+ 搜索（searchSlot）+ 添加（chromeTrail）。
              对话文件页没有搜索和添加（对齐 RZe）。 */}
          {workspaceTab === 'studio' && (
          <div className="workspace-chrome" data-studio-chrome>
            <div className="workspace-chrome-lead" data-open={lastDir ? '' : undefined} aria-hidden={!lastDir || undefined}>
              <button type="button" className="workspace-toolbar-btn" aria-label="返回上级" data-tooltip="返回" onClick={() => setLastDir(null)}>
                <ChevronLeft size={15} />
              </button>
            </div>
            <div className="workspace-search-slot">
              <div className="workspace-search">
                <input
                  type="search"
                  className="workspace-search-input"
                  placeholder="搜索文件名"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
            </div>
            <div className="workspace-chrome-trail" data-open={''}>
              <button type="button" className="workspace-toolbar-btn" aria-label="新建文件夹" data-tooltip="新建文件夹" onClick={() => fileInputRef.current?.click()}>
                <Plus size={15} />
              </button>
            </div>
          </div>
          )}

          {notice && <div className="workspace-notice">{notice}</div>}


        {/* 内容区：对齐 hana 的 sr.stage + sr.layers ——
            两态：外层（挂载点列表）/ 内层（目录树）。
            hana 用 data-inner 标志区分，层切换靠 transform: translate。 */}
        <div className="workspace-stage" data-studio-stage="" data-inner={innerDir !== null ? '' : undefined}>
          {workspaceTab === 'files' ? (
            <div className="workspace-artifact-list" role="list">
              {artifactsQuery.isLoading && <div className="workspace-empty">正在读取产物…</div>}
              {!artifactsQuery.isLoading && artifacts.length === 0 && (
                <div className="workspace-empty">还没有产物。变更单上传外部凭证后会出现在这里。</div>
              )}
              {artifacts.map((item) => (
                <div
                  key={item.id}
                  className={`tree-item${activeTabId === `art:${item.id}` ? ' is-selected' : ''}`}
                  style={{ ['--tree-depth' as string]: 0 }}
                  role="listitem"
                  tabIndex={0}
                  data-artifact-id={item.id}
                  onClick={() => openArtifactTab(item)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openArtifactTab(item); }
                  }}
                >
                  <span className="tree-indent" aria-hidden="true" />
                  <span className="tree-icon">
                    <span className="tree-chevron-placeholder" />
                    <FileKindIcon kind={kindFromExt(item.ext)} size={14} />
                  </span>
                  <span className="tree-main">
                    <span className="tree-name">{item.name}</span>
                    {/* 对齐 hana 的 _fileMeta：类型 · 大小 · 时间 */}
                    <span className="tree-meta">
                      {item.sourceCode} · {formatSize(item.size)} · {formatDate(item.uploadedAt)}
                    </span>
                  </span>
                  <span className="tree-actions">
                    <button
                      type="button"
                      className="tree-action"
                      data-tooltip="预览"
                      aria-label={`预览 ${item.name}`}
                      onClick={(event) => { event.stopPropagation(); openArtifactTab(item); }}
                    >
                      <Eye size={13} />
                    </button>
                    <a
                      className="tree-action"
                      href={`/api/projects/${projectId}/artifacts/${encodeURIComponent(item.id)}/content?download=1${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}`}
                      download={item.name}
                      data-tooltip="下载"
                      aria-label={`下载 ${item.name}`}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <Download size={13} />
                    </a>
                  </span>
                </div>
              ))}
            </div>
          ) : innerDir === null ? (
            /* 外层态：挂载点列表 —— 对齐 hana 的 $et（_layerList）
               每项：图标 + 名称 + 身份标签 + 状态标记。
               moheng 只有一个项目目录，所以就一行「项目根目录」。 */
            <div className="workspace-mount-list" role="list" data-studio-layer="list">
              <button
                type="button"
                className="workspace-mount-row"
                role="listitem"
                data-testid="studio-folder-root"
                onClick={() => setEnteredDir('')}
              >
                <span className="workspace-mount-icon">
                  <FolderKindIcon open={false} size={22} />
                </span>
                <span className="workspace-mount-main">
                  <span className="workspace-mount-name">{projectLabel}</span>
                  <span className="workspace-mount-meta">项目文件目录</span>
                </span>
                <ChevronRight size={14} className="workspace-mount-chevron" />
              </button>
            </div>
          ) : (
            <div
              className="workspace-tree"
              role="tree"
              data-studio-view="tree"
              data-studio-tree-state={treeQuery.isLoading ? 'loading' : treeQuery.error ? 'failed' : 'ready'}
            >
              {treeQuery.isLoading && <div className="workspace-empty">正在读取目录…</div>}
              {!treeQuery.isLoading && rootEntries.length === 0 && (
                <div className="workspace-empty">目录为空，点击上传添加文件</div>
              )}
              {filteredEntries.map((entry) => (
                <TreeNode
                  key={entry.path}
                  projectId={projectId}
                  entry={entry}
                  depth={0}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  selected={selected}
                  onSelect={(e, options) => {
                    // 对齐 hana 的 NQ：多选时切换集合，单选时清空集合并设为主选中
                    if (options?.multi) {
                      setSelectedPaths((prev) => {
                        const next = new Set(prev);
                        if (next.has(e.path)) next.delete(e.path);
                        else next.add(e.path);
                        return next;
                      });
                      setSelected(e);
                      return;
                    }
                    setSelectedPaths(new Set());
                    setSelected(e);
                  }}
                  onDelete={handleDelete}
                  onDirFocus={setLastDir}
                  onOpenTab={openEntryTab}
                  activeTabId={activeTabId}
                  search={search}
                />
              ))}
            </div>
          )}
        </div>
        </div>{/* /workspace-card-surface-main */}
        {/* 抽屉栈：对齐 hana 的 Ket（workspaceCardSurface 的第二个子元素）——
            workspaceDrawerStack └─ workspaceDrawerLayer（纸层：负 margin 叠纸 + 圆角/边框/阴影）
                                  └─ 会话抽屉卡（._card_13ba9：padding 8px 16px, gap 4px） */}
        <div
          className="workspace-drawer-stack"
          data-workspace-drawer-stack
          style={{ ['--workspace-drawer-count' as string]: '1' }}
        >
          <div
            className="workspace-drawer-layer"
            data-workspace-drawer="jian"
            style={{ ['--workspace-drawer-index' as string]: '0' }}
          >
        <section
          className="workspace-jian-drawer"
          data-open={jianOpen ? 'true' : 'false'}
          role="region"
          aria-label="项目文件目录"
        >
          <div className="workspace-jian-header">
            <span className="workspace-jian-title">项目文件目录</span>
            {/* 开关：对齐 hana 的 _jianToggle —— 在 header 右侧，不压列表 */}
            <button
              type="button"
              className="workspace-jian-toggle"
              aria-label={jianOpen ? '收起项目文件目录' : '展开项目文件目录'}
              aria-expanded={jianOpen}
              onClick={() => setJianOpen((v) => !v)}
            >
              <ChevronRight size={14} style={{ transform: jianOpen ? 'rotate(90deg)' : undefined, transition: 'transform 140ms var(--ease-out)' }} />
            </button>
          </div>
          <div className="workspace-jian-body">
            {rootEntries.length === 0 && !treeQuery.isLoading && (
              <div className="workspace-jian-empty">该项目还没有文件。上传后，这里会列出全部目录与文件。</div>
            )}
            {treeQuery.isLoading && <div className="workspace-jian-empty">正在读取…</div>}
            {rootEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="workspace-jian-row"
                data-dir={entry.isDir || undefined}
                onClick={() => { if (!entry.isDir) openEntryTab(entry); }}
              >
                <FileKindIcon kind={kindFromExt(entry.ext)} size={13} />
                <span className="workspace-jian-row-name">{entry.name}</span>
                <span className="workspace-jian-row-meta">
                  {entry.isDir ? '目录' : formatSize(entry.size)}
                </span>
              </button>
            ))}
          </div>
        </section>
          </div>{/* /workspace-drawer-layer */}
        </div>{/* /workspace-drawer-stack */}
      </section>


      {/* 高度调节把手：对齐 hana 的 _separator_704ed
          handle 自己就是 grid 项（占 0px 行），靠 height + 负 margin 撑出热区。 */}
      {showPreview && (
        <CardSplitHandle
          ratio={cardSplitRatio}
          onChange={setCardSplitRatio}
          style={{ gridRow: '2', gridColumn: '1' }}
        />
      )}

      {/* 卡片二：预览。对齐 hana 的 [By] 预览卡（parallelPreview）——
          卡头就是标签栏（._tabBar_2e5d8 = PreviewTabBar），
          内容按 activeTab 分支：空态选择器 / 文件 / 产物。 */}
      {showPreview && (
      <section
        className="workspace-card workspace-card-studio"
        aria-label="文件预览"
        ref={previewCardRef}
        style={{ ['--ttb-clearance-right' as string]: `${previewClearance.right ?? 0}px` }}
      >
        {/* 卡头：对齐 hana 的 ._cardTop_7790b ——
            预览卡的 [By] 定义里 chrome 只有 titlebar-right 的 actions，
            收起入口就在标签栏右端的 Collapse 按钮（_closePanel_b19b5），
            卡头不再另放一个 ×，否则两个关闭入口挤在一起。 */}
        <div className="workspace-card-top">
          <span className="workspace-card-title">预览</span>
        </div>

        {/* 标签栏：对齐 hana 的 VDe —— 收起按钮常驻，无标签时也在 */}
        <PreviewTabBar
          tabs={previewTabs.map((tab) => ({ id: tab.id, title: tab.title, ext: tab.ext }))}
          activeId={activeTabId}
          onActivate={setActiveTabId}
          onClose={closePreviewTab}
          onCollapse={() => setShowPreviewToggle(false)}
        />

        {/* 内容区：对齐 hana 的 _previewPanelBody（overflow hidden，因为 PDF 不能滚） */}
        <div className="workspace-card-scroll workspace-preview-scroll">
          {(() => {
            const active = previewTabs.find((tab) => tab.id === activeTabId) ?? null;
            if (!active) {
              return <PreviewNewTabChooser onPickFiles={handlePreviewPickFiles} hint="或将文件拖到此处" />;
            }
            if (active.source === 'artifact' && active.artifact) {
              return <ArtifactPreview projectId={projectId} artifact={active.artifact} />;
            }
            if (active.entry) {
              return <WorkspacePreview projectId={projectId} entry={active.entry} />;
            }
            return null;
          })()}
        </div>
      </section>
      )}
      </div>{/* /workspace-card-grid */}
    </aside>
  );
}

type TreeNodeProps = {
  projectId: string;
  entry: WorkspaceEntry;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  selected: WorkspaceEntry | null;
  /** 多选：metaKey/ctrlKey 时为 multi */
  onSelect: (entry: WorkspaceEntry, options?: { multi?: boolean }) => void;
  onDelete: (entry: WorkspaceEntry) => void;
  /** 展开文件夹时告知上层，作为上传目标目录 */
  onDirFocus?: (path: string) => void;
  /** 双击文件：开预览标签（对齐 hana 的 onDoubleClick → Hy(tabId)） */
  onOpenTab?: (entry: WorkspaceEntry) => void;
  /** 当前激活的预览标签 id，用于行高亮 */
  activeTabId?: string | null;
  search: string;
};

function TreeNode({ projectId, entry, depth, expanded, setExpanded, selected, onSelect, onDelete, onDirFocus, onOpenTab, activeTabId, search }: TreeNodeProps) {
  const accessToken = useAuthStore((state) => state.accessToken);
  const isOpen = expanded.has(entry.path);
  const isSelected = selected?.path === entry.path;

  // 目录：展开时才请求子层
  const childQuery = useQuery({
    queryKey: ['workspace-tree', projectId, entry.path],
    queryFn: () => api.get<{ path: string; entries: WorkspaceEntry[] }>(
      `/projects/${projectId}/workspace/tree?path=${encodeURIComponent(entry.path)}`,
    ),
    enabled: entry.isDir && isOpen,
  });

  const children = childQuery.data?.entries ?? [];

  // 搜索：名称不匹配时整支跳过（仅对已加载的层生效）
  const hit = !search || entry.name.toLowerCase().includes(search.toLowerCase());
  const childHit = children.some((child) => child.name.toLowerCase().includes(search.toLowerCase()));
  if (search && !hit && !childHit) return null;

  function toggle() {
    if (entry.isDir) {
      // 文件夹只切换展开，不改变选中 ——
      // 否则展开文件夹会清掉正在预览的文件，用户看不到刚打开的内容。
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          onDirFocus?.(entry.path);
        }
        return next;
      });
      return;
    }
    onSelect(entry);
  }

  // 文件操作：对齐 hana 的 NQ 组件五个按钮
  //   预览 / 打开（系统程序）/ 定位（资源管理器）/ 下载 / 删除
  const rawUrl = `/api/projects/${projectId}/workspace/raw?path=${encodeURIComponent(entry.path)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}`;

  return (
    <>
      <div
        className={`tree-item${isSelected ? ' is-selected' : ''}`}
        style={{ ['--tree-depth' as string]: depth }}
        role="treeitem"
        aria-expanded={entry.isDir ? isOpen : undefined}
        aria-selected={isSelected}
        tabIndex={0}
        data-file-id={entry.path}
        onClick={(event) => {
          // 多选：metaKey / ctrlKey
          if (!entry.isDir && (event.metaKey || event.ctrlKey)) {
            event.stopPropagation();
            onSelect(entry, { multi: true });
            return;
          }
          toggle();
        }}
        onDoubleClick={() => { if (!entry.isDir) onOpenTab?.(entry); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }
        }}
      >
        <span className="tree-indent" aria-hidden="true" />
        <span className="tree-icon">
          {entry.isDir
            ? <ChevronRight size={12} className={`tree-chevron${isOpen ? ' is-open' : ''}`} />
            : <span className="tree-chevron-placeholder" />}
          {entry.isDir
            ? <FolderKindIcon open={isOpen} size={14} />
            : <FileKindIcon kind={kindFromExt(entry.ext)} size={14} />}
        </span>
        <span className="tree-main">
          <span className="tree-name">{entry.name}</span>
          {/* 对齐 hana 的 _fileMeta：大小 · 时间（目录不显示大小） */}
          {!entry.isDir && (entry.size !== null || entry.mtime) && (
            <span className="tree-meta">
              {entry.size !== null ? formatSize(entry.size) : ''}
              {entry.size !== null && entry.mtime ? ' · ' : ''}
              {entry.mtime ? formatDate(entry.mtime) : ''}
            </span>
          )}
        </span>
        <span className="tree-actions">
          {!entry.isDir && (
            <>
              <button
                type="button"
                className="tree-action"
                data-tooltip="预览"
                aria-label={`预览 ${entry.name}`}
                onClick={(event) => { event.stopPropagation(); onSelect(entry); }}
              >
                <Eye size={13} />
              </button>
              <a
                className="tree-action"
                href={rawUrl}
                download={entry.name}
                data-tooltip="下载"
                aria-label={`下载 ${entry.name}`}
                onClick={(event) => event.stopPropagation()}
              >
                <Download size={13} />
              </a>
            </>
          )}
          <button
            type="button"
            className="tree-action"
            data-tooltip="删除"
            aria-label={`删除 ${entry.name}`}
            onClick={(event) => { event.stopPropagation(); onDelete(entry); }}
          >
            <Trash2 size={13} />
          </button>
        </span>
      </div>

      {entry.isDir && isOpen && children.map((child) => (
        <TreeNode
          key={child.path}
          projectId={projectId}
          entry={child}
          depth={depth + 1}
          expanded={expanded}
          setExpanded={setExpanded}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          onDirFocus={onDirFocus}
          search={search}
        />
      ))}
    </>
  );
}

function WorkspacePreview({ projectId, entry }: { projectId: string; entry: WorkspaceEntry }) {
  const kind = previewKind(entry.ext);
  // <iframe>/<img>/<a download> 无法自定义 Authorization 头，
  // 所以 raw 端点额外接受 ?token=（后端已支持）。
  const accessToken = useAuthStore((state) => state.accessToken);
  // Chrome 的 PDF viewer 会自带深色工具栏和滚动条。
  //   toolbar=0  隐藏菜单/页码/缩放条
  //   navpanes=0 隐藏左侧缩略图栏
  //   view=FitH  宽度自适应
  //
  // 实测对比：
  //   view=FitH       白像素 99%，右侧仅 6px 暗边（插件固有）
  //   view=Fit        白 57%，暗 266（整页缩得太小）
  //   zoom=page-width 白 86%，暗 91（露出更多查看器背景）
  // 所以取 FitH。那 6px 是 Chrome PDF 插件的右内边距，
  // 要完全消除需要换成 PDF.js 自绘（未做）。
  const pdfSuffix = kind === 'pdf' ? '#toolbar=0&navpanes=0&view=FitH' : '';
  const rawUrl = `/api/projects/${projectId}/workspace/raw?path=${encodeURIComponent(entry.path)}${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}${pdfSuffix}`;

  const textQuery = useQuery({
    queryKey: ['workspace-file', projectId, entry.path],
    // 文本内容走 Authorization 头（比把 token 放 URL 里更安全），
    // 只有 <iframe>/<img> 这类无法加头的场景才用 ?token=。
    queryFn: async () => {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`/api/projects/${projectId}/workspace/raw?path=${encodeURIComponent(entry.path)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`读取失败（${res.status}）`);
      return res.text();
    },
    enabled: kind === 'text',
    staleTime: 30_000,
  });

  return (
    <section className="workspace-preview" aria-label="文件预览">
      <div className="workspace-preview-body">
        {kind === 'pdf' && <iframe className="workspace-preview-frame" src={rawUrl} title={entry.name} />}
        {kind === 'image' && <img className="workspace-preview-image" src={rawUrl} alt={entry.name} />}
        {kind === 'text' && (
          textQuery.isLoading
            ? <div className="workspace-empty">正在读取…</div>
            : textQuery.error
              ? <div className="workspace-empty">{(textQuery.error as Error).message}</div>
              : <pre className="workspace-preview-text">{textQuery.data}</pre>
        )}
        {kind === 'none' && (
          <div className="workspace-empty">
            该类型不支持预览
            <a className="workspace-download" href={rawUrl} download={entry.name}>下载查看</a>
          </div>
        )}
      </div>
    </section>
  );
}

/** 产物预览：变更单外部凭证附件（PDF / 图片 / 文本） */
function ArtifactPreview({ projectId, artifact }: { projectId: string; artifact: ProjectArtifact }) {
  const kind = previewKind(artifact.ext);
  const accessToken = useAuthStore((state) => state.accessToken);
  const pdfSuffix = kind === 'pdf' ? '#toolbar=0&navpanes=0&view=FitH' : '';
  const base = `/api/projects/${projectId}/artifacts/${encodeURIComponent(artifact.id)}/content`;
  const url = `${base}?${accessToken ? `token=${encodeURIComponent(accessToken)}` : ''}${pdfSuffix}`;

  const textQuery = useQuery({
    queryKey: ['artifact-content', projectId, artifact.id],
    queryFn: async () => {
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(base, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) throw new Error(`读取失败（${res.status}）`);
      return res.text();
    },
    enabled: kind === 'text',
    staleTime: 30_000,
  });

  return (
    <section className="workspace-preview" aria-label="产物预览">
      <div className="workspace-preview-body">
        {kind === 'pdf' && <iframe className="workspace-preview-frame" src={url} title={artifact.name} />}
        {kind === 'image' && <img className="workspace-preview-image" src={url} alt={artifact.name} />}
        {kind === 'text' && (
          textQuery.isLoading
            ? <div className="workspace-empty">正在读取…</div>
            : textQuery.error
              ? <div className="workspace-empty">{(textQuery.error as Error).message}</div>
              : <pre className="workspace-preview-text">{textQuery.data}</pre>
        )}
        {kind === 'none' && (
          <div className="workspace-empty">
            该类型不支持预览
            <a className="workspace-download" href={`${base}?download=1${accessToken ? `&token=${encodeURIComponent(accessToken)}` : ''}`} download={artifact.name}>
              下载查看
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error(`读取 ${file.name} 失败`));
    reader.readAsDataURL(file);
  });
}
