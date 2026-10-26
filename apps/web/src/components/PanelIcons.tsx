/**
 * 顶栏面板开关的图标。
 *
 * 逐字取自 hana 的 CardShell-DVSoA_HL.js：
 *
 *   preview 图标 = Lucide file-text，size 15
 *     function SC({ size = 14, width, height, "aria-hidden": ariaHidden = true, ...rest }) {
 *       return <FileTextDef {...rest} width={width ?? size} height={height ?? size} aria-hidden={ariaHidden} />;
 *     }
 *     // 调用：<SC size={15} data-panel-menu-icon="preview" />
 *
 *   workspace 图标 = 自定义 SVG，15×15，strokeWidth 1.889
 *     function Dve() {
 *       return <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
 *                   stroke="currentColor" strokeWidth="1.889" strokeLinecap="round"
 *                   data-panel-menu-icon="workspace">
 *         <g transform="translate(1.42 0.93) scale(0.9)">
 *           <path d="M18 10L13 10" />
 *           <path d="M2 6.94975C2 6.06722 ..." />
 *         </g>
 *       </svg>;
 *     }
 *
 *   strokeWidth 1.889 是把 24 单位 viewBox 压到 15px 显示时的视觉补偿
 *   （24 / 12.7 ≈ 1.889），比直接用 1.5 更重、比 2 更轻。
 */

/** preview 开关图标：Lucide file-text，15px */
export function PreviewPanelIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      data-panel-menu-icon="preview"
    >
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

/** workspace 开关图标：hana 的自定义 SVG，15×15，strokeWidth 1.889 */
export function WorkspacePanelIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.889}
      strokeLinecap="round"
      aria-hidden="true"
      data-panel-menu-icon="workspace"
    >
      <g transform="translate(1.42 0.93) scale(0.9)">
        {/* 文件夹主体：hana 原文的长路径，含左上角的折角 */}
        <path d="M2 6.94975C2 6.06722 2 5.62595 2.06935 5.25839C2.37464 3.64031 3.64031 2.37464 5.25839 2.06935C5.62595 2 6.06722 2 6.94975 2C7.33642 2 7.52976 2 7.71557 2.01738C8.51665 2.09229 9.27652 2.40704 9.89594 2.92051C10.0396 3.03961 10.1763 3.17633 10.4497 3.44975L11 4C11.8158 4.81578 12.2237 5.22367 12.7121 5.49543C12.9804 5.64471 13.2651 5.7626 13.5604 5.84678C14.0979 6 14.6747 6 15.8284 6H16.2021C18.8345 6 20.1506 6 21.0062 6.76946C21.0849 6.84024 21.1598 6.91514 21.2305 6.99383C22 7.84935 22 9.16554 22 11.7979V14C22 17.7712 22 19.6569 20.8284 20.8284C19.6569 22 17.7712 22 14 22H10C6.22876 22 4.34315 22 3.17157 20.8284C2 19.6569 2 17.7712 2 14V6.94975Z" />
        {/* 右侧的横线：hana 的 M18 10L13 10 */}
        <path d="M18 10L13 10" />
      </g>
    </svg>
  );
}

/** 菜单按钮图标：Lucide layers，16px */
export function PanelMenuIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </svg>
  );
}
