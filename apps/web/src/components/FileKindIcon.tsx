/**
 * 文件类型图标。
 *
 * SVG 路径逐字取自 hana 的 Os 图标表（CardShell-DVSoA_HL.js），
 * 也就是 Lucide 的原始 node 数据，不是自己画的近似图标。
 *
 *   doc       file-text 变体（带两条横线）
 *   markdown  带 M 字形
 *   image     rect + circle + 折线
 *   video     rect + play 三角
 *   audio     五条竖线
 *   code      < >
 *   pdf       file 轮廓（无内线）
 *   file      file 轮廓（通用）
 *
 * 尺寸：hana 在文件行里用 14px、stroke-width 1.5。
 */

export type FileKind = 'doc' | 'markdown' | 'image' | 'video' | 'audio' | 'code' | 'pdf' | 'file';

const PATHS: Record<FileKind, { name: string; node: Array<[string, Record<string, string>]> }> = {
  doc: {
    name: 'file-text',
    node: [
      ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
      ['polyline', { points: '14 2 14 8 20 8' }],
      ['line', { x1: '8', y1: '13', x2: '16', y2: '13' }],
      ['line', { x1: '8', y1: '17', x2: '14', y2: '17' }],
    ],
  },
  markdown: {
    name: 'file-markdown',
    node: [
      ['path', { d: 'M4 5h16v14H4z' }],
      ['path', { d: 'M7 15V9l3 3 3-3v6' }],
      ['path', { d: 'M16 9v6' }],
      ['path', { d: 'M14.5 13.5 16 15l1.5-1.5' }],
    ],
  },
  image: {
    name: 'image',
    node: [
      ['rect', { x: '3', y: '3', width: '18', height: '18', rx: '2', ry: '2' }],
      ['circle', { cx: '8.5', cy: '8.5', r: '1.5' }],
      ['polyline', { points: '21 15 16 10 5 21' }],
    ],
  },
  video: {
    name: 'video',
    node: [
      ['rect', { x: '3', y: '5', width: '18', height: '14', rx: '2' }],
      ['polygon', { points: '10 9 15 12 10 15 10 9' }],
    ],
  },
  audio: {
    name: 'audio-lines',
    node: [
      ['path', { d: 'M4 10v4' }],
      ['path', { d: 'M8 7v10' }],
      ['path', { d: 'M12 5v14' }],
      ['path', { d: 'M16 8v8' }],
      ['path', { d: 'M20 11v2' }],
    ],
  },
  code: {
    name: 'code',
    node: [
      ['polyline', { points: '16 18 22 12 16 6' }],
      ['polyline', { points: '8 6 2 12 8 18' }],
    ],
  },
  pdf: {
    name: 'file',
    node: [
      ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
      ['polyline', { points: '14 2 14 8 20 8' }],
    ],
  },
  file: {
    name: 'file',
    node: [
      ['path', { d: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' }],
      ['polyline', { points: '14 2 14 8 20 8' }],
    ],
  },
};

/** 扩展名 → 文件类型。判定顺序对齐 hana 的 VQ：image/svg → video → audio → pdf → doc → markdown → code → file */
export function kindFromExt(ext?: string): FileKind {
  const e = (ext ?? '').toLowerCase().replace(/^\./, '');
  if (!e) return 'file';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif'].includes(e)) return 'image';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'm4v'].includes(e)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(e)) return 'audio';
  if (e === 'pdf') return 'pdf';
  if (['doc', 'docx', 'rtf', 'odt', 'xls', 'xlsx', 'ods', 'ppt', 'pptx', 'odp'].includes(e)) return 'doc';
  if (['md', 'markdown', 'mkd'].includes(e)) return 'markdown';
  if (['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'scss', 'xml', 'yaml', 'yml', 'py', 'go', 'rs', 'java', 'sql', 'sh', 'ps1'].includes(e)) return 'code';
  return 'file';
}

type Props = {
  kind: FileKind;
  size?: number;
  className?: string;
};

export function FileKindIcon({ kind, size = 14, className }: Props) {
  const spec = PATHS[kind] ?? PATHS.file;
  return (
    <svg
      className={className}
      data-file-kind={kind}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {spec.node.map(([tag, attrs], index) => {
        const Tag = tag as 'path' | 'polyline' | 'line' | 'circle' | 'rect' | 'polygon';
        return <Tag key={index} {...attrs} />;
      })}
    </svg>
  );
}

/** 文件夹图标：hana 的 Os.folder / folderOpen */
export function FolderKindIcon({ open = false, size = 14, className }: { open?: boolean; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      data-file-kind="folder"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {open ? (
        <>
          <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
          <path d="M2 10h20" />
        </>
      ) : (
        <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
      )}
    </svg>
  );
}
