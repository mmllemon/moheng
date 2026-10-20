import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Check, Layers3, Palette, RotateCcw, SlidersHorizontal, Type, X } from 'lucide-react';
import { applyUiPreferences, useUiStore, type PaperTextureStyle, type UiTheme } from '../auth-store';
import { useAnimatedPresence } from './useAnimatedPresence';

const themeChoices: Array<{ value: UiTheme; label: string; note: string; bg: string; sidebar: string; card: string }> = [
  { value: 'warm-paper', label: '暖纸', note: 'Hana 默认', bg: '#f8f4ed', sidebar: '#f4f0ea', card: '#fcfaf5' },
  { value: 'plain-white', label: '素白', note: '清透', bg: '#fbfaf7', sidebar: '#f3f1ec', card: '#ffffff' },
  { value: 'midnight', label: '青夜', note: '低光', bg: '#26343d', sidebar: '#202c34', card: '#30414b' },
];
const textureChoices: Array<{ value: PaperTextureStyle; label: string; note: string }> = [
  { value: 'rice', label: '宣纸', note: '长纤维、云斑' },
  { value: 'cotton', label: '棉纸', note: '短纤维、柔絮' },
  { value: 'fine', label: '细纸', note: '细颗粒、低对比' },
  { value: 'off', label: '无', note: '纯色纸面' },
];

export default function UiPreferencesBar({ compact = false }: { compact?: boolean }) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const presence = useAnimatedPresence(open, 150);
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const reduceMotion = useUiStore((state) => state.reduceMotion);
  const wideContent = useUiStore((state) => state.wideContent);
  const paperTexture = useUiStore((state) => state.paperTexture);
  const paperTextureStrength = useUiStore((state) => state.paperTextureStrength);
  const setTheme = useUiStore((state) => state.setTheme);
  const setPaperTexture = useUiStore((state) => state.setPaperTexture);
  const setPaperTextureStrength = useUiStore((state) => state.setPaperTextureStrength);
  const setDensity = useUiStore((state) => state.setDensity);
  const toggleReduceMotion = useUiStore((state) => state.toggleReduceMotion);
  const toggleWideContent = useUiStore((state) => state.toggleWideContent);
  const reset = useUiStore((state) => state.resetUiPreferences);

  useEffect(() => {
    applyUiPreferences({ theme, density, accent: 'theme', reduceMotion, wideContent, paperTexture, paperTextureStrength });
  }, [theme, density, reduceMotion, wideContent, paperTexture, paperTextureStrength]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return <div className="appearance-wrap" ref={wrapperRef}>
    <button
      type="button"
      className={`titlebar-icon ${open ? 'is-active' : ''}`}
      aria-label="外观与显示设置"
      title="外观与显示设置"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    ><Palette size={16} strokeWidth={1.65} /><span className="sr-only">{compact ? '外观设置' : '外观与显示设置'}</span></button>
    {presence.mounted && <section className={`appearance-popover ${presence.visible ? 'is-visible' : 'is-closing'}`} role="dialog" aria-label="外观与显示设置" aria-hidden={!open}>
      <header className="appearance-head">
        <div><h2>外观与显示</h2><p>只影响当前浏览器，不改动业务数据</p></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="关闭外观设置"><X size={15} /></button>
      </header>
      <div className="appearance-body">
        <div className="appearance-label"><span>纸张</span><span>{themeChoices.find((choice) => choice.value === theme)?.note}</span></div>
        <div className="appearance-themes" role="group" aria-label="纸张主题">
          {themeChoices.map((choice) => <button
            key={choice.value}
            type="button"
            className={`appearance-theme ${theme === choice.value ? 'is-active' : ''}`}
            aria-pressed={theme === choice.value}
            onClick={() => setTheme(choice.value)}
          >
            <span className="appearance-theme-swatch" style={{ '--theme-bg': choice.bg, '--theme-sidebar': choice.sidebar, '--theme-card': choice.card } as CSSProperties} />
            <strong>{choice.label}</strong>
            <small>{theme === choice.value ? <><Check size={9} /> 使用中</> : choice.note}</small>
          </button>)}
        </div>

        <div className="appearance-label"><span>纸纹</span><span>Hana 1.1.35 原版 · {textureChoices.find((choice) => choice.value === paperTexture)?.note}</span></div>
        <div className="appearance-texture-choices" role="group" aria-label="纸张纹理">
          {textureChoices.map((choice) => <button
            key={choice.value}
            type="button"
            className={`appearance-texture-choice ${paperTexture === choice.value ? 'is-active' : ''}`}
            aria-pressed={paperTexture === choice.value}
            title={`${choice.label} · ${choice.note}`}
            onClick={() => setPaperTexture(choice.value)}
          ><span className={`appearance-texture-mark texture-${choice.value}`} aria-hidden="true" />{choice.label}</button>)}
        </div>
        <div className="appearance-row appearance-strength-row">
          <span><strong>纹理强度</strong><small>{paperTexture === 'off' ? '未启用纸纹' : `${Math.round(paperTextureStrength * 100)}% · 表面明暗差`}</small></span>
          <input className="appearance-range" type="range" min="0.5" max="1.5" step="0.25" value={paperTextureStrength} disabled={paperTexture === 'off'} aria-label="纸纹强度" onChange={(event) => setPaperTextureStrength(Number(event.target.value))} />
        </div>

        <div className="appearance-label"><span>工作区</span><SlidersHorizontal size={12} /></div>
        <div className="appearance-row">
          <span><strong>信息密度</strong><small>表格与表单的行距</small></span>
          <div className="appearance-segment" role="group" aria-label="信息密度">
            <button type="button" className={density === 'comfortable' ? 'is-active' : ''} aria-pressed={density === 'comfortable'} onClick={() => setDensity('comfortable')}>舒朗</button>
            <button type="button" className={density === 'compact' ? 'is-active' : ''} aria-pressed={density === 'compact'} onClick={() => setDensity('compact')}>紧凑</button>
          </div>
        </div>
        <div className="appearance-row">
          <span><strong>宽屏内容</strong><small>减少两侧留白，显示更多列</small></span>
          <button type="button" className={`ui-switch ${wideContent ? 'is-on' : ''}`} role="switch" aria-checked={wideContent} aria-label="宽屏内容" onClick={toggleWideContent}><i /></button>
        </div>
        <div className="appearance-row">
          <span><strong>减少动效</strong><small>保留必要状态反馈</small></span>
          <button type="button" className={`ui-switch ${reduceMotion ? 'is-on' : ''}`} role="switch" aria-checked={reduceMotion} aria-label="减少动效" onClick={toggleReduceMotion}><i /></button>
        </div>
        <div className="appearance-row">
          <span><strong>恢复默认</strong><small>暖纸、宣纸、舒朗、标准宽度</small></span>
          <button type="button" className="panel-header-action" onClick={reset}><RotateCcw size={12} />重置</button>
        </div>
        <div className="appearance-footnote"><Layers3 size={11} />纸纹直接取自 Hana 1.1.35，可切换三种纸面或关闭；强度只影响纹理明暗差。</div>
        <div className="appearance-footnote"><Type size={11} />界面字号跟随系统显示设置，不在此处缩小。</div>
      </div>
    </section>}
  </div>;
}
