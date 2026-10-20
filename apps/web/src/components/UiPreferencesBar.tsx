import { useEffect, useRef, useState } from 'react';
import { Check, LayoutDashboard, Monitor, Palette, RotateCcw, Settings2, SlidersHorizontal, Type, Zap, X } from 'lucide-react';
import { useUiStore } from '../auth-store';
import { useAnimatedPresence } from './useAnimatedPresence';

const themeChoices = [
  { value: 'ivory' as const, label: '象牙雅白', short: '象牙', swatch: 'theme-swatch-ivory', note: '温润、中性、适合日常经营' },
  { value: 'champagne' as const, label: '香槟曜金', short: '曜金', swatch: 'theme-swatch-champagne', note: '低饱和暖色、稳重细腻' },
  { value: 'obsidian' as const, label: '黑曜极光', short: '黑曜', swatch: 'theme-swatch-obsidian', note: '深色低眩光、适合夜间工作' },
  { value: 'glacier' as const, label: '冰川天青', short: '冰川', swatch: 'theme-swatch-glacier', note: '清透冷色、信息层次清楚' },
];

export default function UiPreferencesBar() {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const presence = useAnimatedPresence(open, 190);
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const accent = useUiStore((state) => state.accent);
  const reduceMotion = useUiStore((state) => state.reduceMotion);
  const wideContent = useUiStore((state) => state.wideContent);
  const setTheme = useUiStore((state) => state.setTheme);
  const setDensity = useUiStore((state) => state.setDensity);
  const setAccent = useUiStore((state) => state.setAccent);
  const toggleReduceMotion = useUiStore((state) => state.toggleReduceMotion);
  const toggleWideContent = useUiStore((state) => state.toggleWideContent);
  const reset = useUiStore((state) => state.resetUiPreferences);

  useEffect(() => {
    const root = document.documentElement;
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = 'ivory';
      // Theme rendering uses one canonical attribute; legacy data-theme selectors
      // created competing CSS cascades and could leave stale backgrounds after switches.
      root.dataset.themeName = resolved;
      root.dataset.themePreference = 'ivory';
      root.dataset.density = density;
      root.dataset.accent = 'theme';
      root.dataset.motion = reduceMotion ? 'reduced' : 'full';
      root.dataset.contentWidth = wideContent ? 'wide' : 'standard';
    };
    applyTheme();
    if (theme !== 'system' || !media) return;
    media.addEventListener?.('change', applyTheme);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [theme, density, accent, reduceMotion, wideContent]);

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

  return <div className="ui-preferences-wrap" ref={wrapperRef}>
    <button
      type="button"
      className={`ui-preferences-trigger ${open ? 'is-active' : ''}`}
      aria-label="界面设置"
      title="界面与交互设置"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    ><Settings2 size={17} /><span>界面设置</span></button>
    {presence.mounted && <section className={`ui-preferences-popover ${presence.visible ? 'is-visible' : 'is-closing'}`} role="dialog" aria-label="界面与交互设置" aria-hidden={!open}>
      <header className="ui-pref-popover-header">
        <div><span className="ui-pref-popover-kicker">MOHENG / PERSONALIZE</span><h2>界面与交互</h2><p>仅影响当前浏览器的显示偏好</p></div>
        <button type="button" className="icon-button" onClick={() => setOpen(false)} aria-label="关闭界面设置"><X size={16} /></button>
      </header>
      <div className="ui-pref-popover-content">
        <section className="ui-pref-popover-section">
          <div className="ui-pref-section-heading"><span><Palette size={14} />材质主题</span><small>THEME</small></div>
          <div className="ui-theme-grid" role="group" aria-label="材质主题">
            {themeChoices.map((choice) => <button key={choice.value} type="button" className={`ui-theme-card ${theme === choice.value ? 'active' : ''}`} aria-pressed={theme === choice.value} onClick={() => setTheme(choice.value)}>
              <span className={`ui-theme-preview ${choice.swatch}`}><i /><i /><i /></span>
              <span className="ui-theme-card-copy"><strong>{choice.label}</strong><small>{choice.note}</small></span>
              <span className="ui-theme-card-check">{theme === choice.value && <Check size={13} />}</span>
            </button>)}
          </div>
          <button type="button" className={`ui-system-theme-row ${theme === 'system' ? 'active' : ''}`} aria-pressed={theme === 'system'} onClick={() => setTheme('system')}><span className="ui-system-theme-icon"><Monitor size={15} /></span><span><strong>跟随系统</strong><small>自动适配系统浅色或深色外观</small></span><span className="ui-theme-card-check">{theme === 'system' && <Check size={13} />}</span></button>
        </section>
        <section className="ui-pref-popover-section">
          <div className="ui-pref-section-heading"><span><SlidersHorizontal size={14} />工作区</span><small>LAYOUT</small></div>
          <div className="ui-pref-setting-row"><span className="ui-pref-setting-icon"><Type size={15} /></span><span className="ui-pref-setting-copy"><strong>信息密度</strong><small>按工作习惯调整表格与卡片间距</small></span><div className="ui-segmented ui-segmented-small" role="group" aria-label="界面密度"><button type="button" className={density === 'comfortable' ? 'active' : ''} aria-pressed={density === 'comfortable'} onClick={() => setDensity('comfortable')}>舒朗</button><button type="button" className={density === 'compact' ? 'active' : ''} aria-pressed={density === 'compact'} onClick={() => setDensity('compact')}>紧凑</button></div></div>
          <button type="button" className={`ui-pref-setting-row ui-pref-row-button ${wideContent ? 'active' : ''}`} aria-pressed={wideContent} onClick={toggleWideContent}><span className="ui-pref-setting-icon"><LayoutDashboard size={15} /></span><span className="ui-pref-setting-copy"><strong>宽屏工作区</strong><small>减少两侧留白，显示更多业务列</small></span><span className={`ui-switch ${wideContent ? 'is-on' : ''}`}><i /></span></button>
        </section>
        <section className="ui-pref-popover-section">
          <div className="ui-pref-section-heading"><span><Zap size={14} />交互偏好</span><small>INTERACTION</small></div>
          <div className="ui-pref-accent-row"><span><strong>强调色</strong><small>用于主操作、选中态与聚焦提示</small></span><div className="ui-accent-palette" role="group" aria-label="强调色">
            <button type="button" className={`ui-accent-dot accent-theme ${accent === 'theme' ? 'active' : ''}`} aria-label="跟随主题色" aria-pressed={accent === 'theme'} title="跟随主题色" onClick={() => setAccent('theme')}>{accent === 'theme' && <Check size={11} />}</button>
            <button type="button" className={`ui-accent-dot accent-indigo ${accent === 'indigo' ? 'active' : ''}`} aria-label="靛青强调色" aria-pressed={accent === 'indigo'} title="靛青强调色" onClick={() => setAccent('indigo')}>{accent === 'indigo' && <Check size={11} />}</button>
            <button type="button" className={`ui-accent-dot accent-jade ${accent === 'jade' ? 'active' : ''}`} aria-label="青玉强调色" aria-pressed={accent === 'jade'} title="青玉强调色" onClick={() => setAccent('jade')}>{accent === 'jade' && <Check size={11} />}</button>
            <button type="button" className={`ui-accent-dot accent-cinnabar ${accent === 'cinnabar' ? 'active' : ''}`} aria-label="朱砂强调色" aria-pressed={accent === 'cinnabar'} title="朱砂强调色" onClick={() => setAccent('cinnabar')}>{accent === 'cinnabar' && <Check size={11} />}</button>
          </div></div>
          <button type="button" className={`ui-pref-setting-row ui-pref-row-button ${reduceMotion ? 'active' : ''}`} aria-pressed={reduceMotion} onClick={toggleReduceMotion}><span className="ui-pref-setting-icon"><Zap size={15} /></span><span className="ui-pref-setting-copy"><strong>减少动效</strong><small>保留必要状态反馈，降低位移与过渡</small></span><span className={`ui-switch ${reduceMotion ? 'is-on' : ''}`}><i /></span></button>
        </section>
      </div>
      <footer className="ui-pref-popover-footer"><span>显示设置与业务数据相互独立</span><button type="button" className="ui-pref-reset" onClick={reset}><RotateCcw size={13} /><span>恢复默认</span></button></footer>
    </section>}
  </div>;
}
