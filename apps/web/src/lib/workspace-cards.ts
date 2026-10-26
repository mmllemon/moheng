/**
 * 右侧浮层卡片定义表。
 *
 * 对齐 hana 的 rightWorkspace 卡片定义（ChatTranscript-BhjBc-kF.js）：
 *
 *   kY = {
 *     "session-files": { stackItemId: "workspace-session-files",
 *                        cardDefinitionId: nR,
 *                        titleKey: "rightWorkspace.tabs.sessionFiles" },
 *     workspace:       { stackItemId: "desk",
 *                        cardDefinitionId: tR,
 *                        titleKey: "rightWorkspace.tabs.workspace" },
 *   }
 *   CY = ["session-files", "workspace"]
 *
 *   function TY(ids, state) { return ids.filter((n) => table[n].visibleWhen(state)); }
 *
 * 卡片不是写死的，由 visibleWhen 决定显隐。hana 的卡片栈上限是 12 张（const E8 = 12）。
 *
 * moheng 的两张卡：
 *   files   ← 项目产物 / 项目目录树（主卡）
 *   preview ← 选中文件或产物的预览
 */

/** 卡片栈上限，对齐 hana 的 const E8 = 12 */
export const MAX_STACK_CARDS = 12;

export type WorkspaceCardId = 'files' | 'preview';

export type WorkspaceCardState = {
  /** 是否有选中项（文件或产物） */
  hasSelection: boolean;
  /** 当前标签：对话文件 / 工作室 */
  tab: 'files' | 'studio';
};

export type WorkspaceCardDefinition = {
  id: WorkspaceCardId;
  /** 卡头标题 */
  title: string;
  /** 对齐 hana 的 visibleWhen */
  visibleWhen: (state: WorkspaceCardState) => boolean;
  /** 对齐 hana 的 rightMeta：卡头右侧的附加信息 */
  rightMeta?: (state: WorkspaceCardState) => string | null;
};

export const WORKSPACE_CARDS: Record<WorkspaceCardId, WorkspaceCardDefinition> = {
  files: {
    id: 'files',
    title: '文件',
    // 主卡常驻：即使没选中任何文件，也要能浏览目录 / 产物列表
    visibleWhen: () => true,
  },
  preview: {
    id: 'preview',
    title: '预览',
    // 只有选中文件或产物时才出现 —— 这是 hana 的做法：
    //   没有内容就不占空间，而不是留一张空卡。
    visibleWhen: (state) => state.hasSelection,
  },
};

/** 卡片顺序，对齐 hana 的 const CY = ["session-files", "workspace"] */
export const WORKSPACE_CARD_ORDER: WorkspaceCardId[] = ['files', 'preview'];

/** 按状态过滤出应显示的卡片，对齐 hana 的 TY() */
export function visibleCards(state: WorkspaceCardState): WorkspaceCardDefinition[] {
  return WORKSPACE_CARD_ORDER
    .filter((id) => WORKSPACE_CARDS[id].visibleWhen(state))
    .slice(0, MAX_STACK_CARDS)
    .map((id) => {
      const def = WORKSPACE_CARDS[id];
      return { ...def, meta: def.rightMeta?.(state) ?? null } as WorkspaceCardDefinition;
    });
}
