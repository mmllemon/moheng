/** 工作区条目（文件或目录）。对齐 Hana 的 isDir 约定：目录 size 为 null。 */
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

/** 项目产物（对话文件标签的数据源）。 */
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
