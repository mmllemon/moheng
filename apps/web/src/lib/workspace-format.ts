import { File as FileIcon, FileImage, FileSpreadsheet, FileText, Folder } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { WorkspaceEntry } from './workspace-types';

/** 对话文件页的排序标签：对齐 hana 的 MQ(Z) ——
    hana 的四档是 time-desc / name-asc / name-desc / type-asc，
    moheng 只有三个可用维度（时间 / 名称 / 大小）。 */
export const ARTIFACT_SORT_LABEL = { time: '时间', name: '名称', size: '大小' } as const;

/** 工作区排序选项：对齐 hana 的 OJe()（localStorage key `hana-desk-sort`） */
export const DESK_SORT_OPTIONS = [
  { id: 'name', label: '名称' },
  { id: 'mtime', label: '修改时间' },
  { id: 'size', label: '大小' },
] as const;
export const DESK_SORT_LABEL = Object.fromEntries(
  DESK_SORT_OPTIONS.map((o) => [o.id, o.label]),
) as Record<(typeof DESK_SORT_OPTIONS)[number]['id'], string>;

/** 扩展名 → 图标 */
export function iconFor(entry: WorkspaceEntry): LucideIcon {
  if (entry.isDir) return Folder;
  const ext = entry.ext ?? '';
  if (/^\.(png|jpg|jpeg|webp|gif|bmp|svg)$/.test(ext)) return FileImage;
  if (/^\.(xlsx|xls|csv)$/.test(ext)) return FileSpreadsheet;
  if (/^\.(txt|md|json|log|xml|html)$/.test(ext)) return FileText;
  return FileIcon;
}

/** 人类可读大小 */
export function formatSize(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 人类可读时间（对齐 hana 的 _fileMeta 时间格式：月/日 时:分） */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 判断能否内嵌预览 */
export function previewKind(ext?: string): 'pdf' | 'image' | 'text' | 'none' {
  const e = ext ?? '';
  if (e === '.pdf') return 'pdf';
  if (/^\.(png|jpg|jpeg|webp|gif|bmp)$/.test(e)) return 'image';
  if (/^\.(txt|md|json|log|xml|csv)$/.test(e)) return 'text';
  return 'none';
}

export function readAsBase64(file: File): Promise<string> {
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
