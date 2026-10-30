/**
 * 工作区目录树节点（递归）。从 WorkspacePanel 拆出，逻辑零改动。
 *
 * 对齐 hana 的 NQ 组件：展开/选中、双击开标签、行内预览/下载/删除。
 */

import type { Dispatch, SetStateAction } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Download, Eye, Trash2 } from 'lucide-react';

import { api } from '../api';
import { useAuthStore } from '../auth-store';
import { Button } from './Ui';
import { FileKindIcon, FolderKindIcon, kindFromExt } from './FileKindIcon';
import { formatDate, formatSize } from '../lib/workspace-format';
import type { WorkspaceEntry } from '../lib/workspace-types';

export type TreeNodeProps = {
  projectId: string;
  entry: WorkspaceEntry;
  depth: number;
  expanded: Set<string>;
  setExpanded: Dispatch<SetStateAction<Set<string>>>;
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

export function TreeNode({ projectId, entry, depth, expanded, setExpanded, selected, onSelect, onDelete, onDirFocus, onOpenTab, activeTabId, search }: TreeNodeProps) {
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
              <Button
                variant="ghost"
                size="icon-sm"
                data-tooltip="预览"
                aria-label={`预览 ${entry.name}`}
                onClick={(event) => { event.stopPropagation(); onSelect(entry); }}
              >
                <Eye size={13} />
              </Button>
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
          <Button
            variant="ghost"
            size="icon-sm"
            data-tooltip="删除"
            aria-label={`删除 ${entry.name}`}
            onClick={(event) => { event.stopPropagation(); onDelete(entry); }}
          >
            <Trash2 size={13} />
          </Button>
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
