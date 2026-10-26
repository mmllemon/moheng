/**
 * PaperTextureLayer：hana 的纸纹层（Hd 组件）。
 *
 * 真值来自 CapabilitiesPanel 的 ._layer_0d743 / ._hi_12639 / ._lo_28564：
 *   - 层本身 position:absolute; inset:0; z-index:var(--z-under); pointer-events:none
 *   - 默认 display:none，靠 html[data-paper-texture] 打开
 *   - 内部两片 _hi / _lo，各自用三层 mask（mottle 1024 / fiber 720 / grain 256）
 *     以 oklch 提亮 / 压暗 --paper-texture-surface
 *
 * 用法：放进任何一个 position:relative 的容器，它自己 absolute 铺满。
 */
export default function PaperTextureLayer() {
  return (
    <div className="paper-layer" data-paper-texture-layer aria-hidden="true">
      <div className="paper-layer-hi" />
      <div className="paper-layer-lo" />
    </div>
  );
}
