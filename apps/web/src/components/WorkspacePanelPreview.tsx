/**
 * 工作区预览子组件：文件预览（WorkspacePreview）与产物预览（ArtifactPreview）。
 *
 * 从 WorkspacePanel 拆出，逻辑零改动，仅移出以减少主组件体积。
 * PDF 用 Chrome 内置查看器（#toolbar=0&navpanes=0&view=FitH），
 * 文本走 Authorization 头，图片/iframe 这类无法加头的走 ?token=。
 */

import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '../auth-store';
import { previewKind } from '../lib/workspace-format';
import type { WorkspaceEntry, ProjectArtifact } from '../lib/workspace-types';

export function WorkspacePreview({ projectId, entry }: { projectId: string; entry: WorkspaceEntry }) {
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
export function ArtifactPreview({ projectId, artifact }: { projectId: string; artifact: ProjectArtifact }) {
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
