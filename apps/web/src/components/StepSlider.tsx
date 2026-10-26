import type { CSSProperties } from 'react';

/**
 * 分档滑块：对齐 hana 的 Rr 组件（SettingsModalShell）。
 *
 * hana 的真实结构（JSX）：
 *   <div class=slider>                          flex column, gap 4px, width 198px
 *     <div class=rail>                          position: relative, isolation: isolate
 *       <div class=underlay>                     absolute inset 0, z-index -1
 *         <div class=segments>                   分段条（count = options.length - 1）
 *           <span class=segment data-on />       flex:1, radius 999px, bg --border
 *           ...                                  已选段 bg --accent
 *       <input type=range class=input />        appearance:none, 透明轨道
 *     <div class=under>                         标签行，space-between
 *       <span class=endLabel>首项</span>
 *       <span class=readout>当前值</span>         accent-light 底 + accent 字，圆角
 *       <span class=endLabel>末项</span>
 *
 * 关键：**分段数 = options.length - 1**，不是 options.length。
 * 4 档 → 3 段，段与段之间 2px 间隙，段高 4px。
 * 圆滑块 14px 叠在分段条上方，白色描边 2px。
 *
 * 尺寸（hana 真值）：
 *   --step-slider-thumb: 14px
 *   --step-slider-track: calc(14px / 3.5) = 4px
 *   --step-slider-inset: calc(14px / 2) = 7px
 *   --step-slider-rail-height: 14px + 8px = 22px
 *   --step-slider-caption-height: 14px + 4px = 18px
 */
export type StepSliderProps = {
  ariaLabel: string;
  value: number;
  options: readonly string[];
  onChange: (index: number) => void;
  disabled?: boolean;
  /** 滑块宽度，默认 198px（hana 值） */
  width?: string | number;
};

export function StepSlider({ ariaLabel, value, options, onChange, disabled = false, width }: StepSliderProps) {
  if (options.length === 0) return null;

  const index = Math.max(0, Math.min(options.length - 1, value));
  const lastIndex = options.length - 1;
  const segmentCount = lastIndex; // 分段数 = 档位数 - 1

  // 用最宽的标签撑开 readout，避免切换时宽度跳动
  const widest = options.reduce((a, b) => (b.length > a.length ? b : a), '');

  const style: CSSProperties | undefined = width
    ? ({ width: typeof width === 'number' ? `${width}px` : width } as CSSProperties)
    : undefined;

  return (
    <div className="step-slider" style={style}>
      <div className="step-slider-rail">
        <div className="step-slider-underlay" aria-hidden="true">
          {segmentCount > 0 && (
            <div className="step-slider-segments" data-step-slider-segments="">
              {Array.from({ length: segmentCount }, (_, i) => (
                <span key={i} className="step-slider-segment" data-on={i < index ? '' : undefined} />
              ))}
            </div>
          )}
        </div>
        <input
          type="range"
          min={0}
          max={lastIndex}
          step={1}
          value={index}
          className="step-slider-input"
          aria-label={ariaLabel}
          aria-valuetext={options[index]}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <div className="step-slider-under">
        <span className="step-slider-end-label" data-step-slider-end="start">{options[0]}</span>
        <span className="step-slider-readout" data-step-slider-readout="">
          <span className="step-slider-sizer" aria-hidden="true">{widest}</span>
          <span data-step-slider-value="">{options[index]}</span>
        </span>
        <span className="step-slider-end-label" data-step-slider-end="end">{options[lastIndex]}</span>
      </div>
    </div>
  );
}
