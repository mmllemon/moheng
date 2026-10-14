import { useEffect } from 'react';
import { Check, LayoutDashboard, Monitor, Moon, RotateCcw, SlidersHorizontal, Sun, Type, Zap } from 'lucide-react';
import { useUiStore } from '../auth-store';

export default function UiPreferencesBar() {
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
    const applyTheme = () => {
      const resolved = theme === 'system'
        ? (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
        : theme;
      root.dataset.theme = resolved;
      root.dataset.themePreference = theme;
      root.dataset.density = density;
      root.dataset.accent = accent;
      root.dataset.motion = reduceMotion ? 'reduced' : 'full';
      root.dataset.contentWidth = wideContent ? 'wide' : 'standard';
    };
    applyTheme();
    if (theme !== 'system' || !window.matchMedia) return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener?.('change', applyTheme);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [theme, density, accent, reduceMotion, wideContent]);

  return <div className="ui-preferences-bar" aria-label="界面设置">
    <div className="ui-pref-section ui-pref-appearance"><span className="ui-pref-label"><SlidersHorizontal size={13} />外观</span><div className="ui-segmented" role="group" aria-label="主题模式">
      <button type="button" className={theme === 'light' ? 'active' : ''} aria-pressed={theme === 'light'} onClick={() => setTheme('light')} title="浅色模式"><Sun size={14} /><span>浅色</span></button>
      <button type="button" className={theme === 'dark' ? 'active' : ''} aria-pressed={theme === 'dark'} onClick={() => setTheme('dark')} title="深色模式"><Moon size={14} /><span>深色</span></button>
      <button type="button" className={theme === 'system' ? 'active' : ''} aria-pressed={theme === 'system'} onClick={() => setTheme('system')} title="跟随系统主题"><Monitor size={14} /><span>系统</span></button>
    </div></div>
    <span className="ui-pref-divider" />
    <div className="ui-pref-section"><span className="ui-pref-label"><Type size={13} />密度</span><div className="ui-segmented ui-segmented-small" role="group" aria-label="界面密度"><button className={density === 'comfortable' ? 'active' : ''} aria-pressed={density === 'comfortable'} onClick={() => setDensity('comfortable')}>标准</button><button className={density === 'compact' ? 'active' : ''} aria-pressed={density === 'compact'} onClick={() => setDensity('compact')}>紧凑</button></div></div>
    <span className="ui-pref-divider" />
    <div className="ui-pref-section"><span className="ui-pref-label">强调色</span><div className="ui-accent-palette" role="group" aria-label="强调色">
      <button className={`ui-accent-dot accent-indigo ${accent === 'indigo' ? 'active' : ''}`} aria-label="靛青" aria-pressed={accent === 'indigo'} onClick={() => setAccent('indigo')}>{accent === 'indigo' && <Check size={11} />}</button>
      <button className={`ui-accent-dot accent-jade ${accent === 'jade' ? 'active' : ''}`} aria-label="青玉" aria-pressed={accent === 'jade'} onClick={() => setAccent('jade')}>{accent === 'jade' && <Check size={11} />}</button>
      <button className={`ui-accent-dot accent-cinnabar ${accent === 'cinnabar' ? 'active' : ''}`} aria-label="朱砂" aria-pressed={accent === 'cinnabar'} onClick={() => setAccent('cinnabar')}>{accent === 'cinnabar' && <Check size={11} />}</button>
    </div></div>
    <span className="ui-pref-divider" />
    <button type="button" className={`ui-pref-toggle ${wideContent ? 'active' : ''}`} aria-pressed={wideContent} onClick={toggleWideContent} title="减少两侧留白，使用宽屏布局"><LayoutDashboard size={14} /><span>宽屏</span></button>
    <button type="button" className={`ui-pref-toggle ${reduceMotion ? 'active' : ''}`} aria-pressed={reduceMotion} onClick={toggleReduceMotion} title="减少页面切换和弹层动画"><Zap size={14} /><span>减少动效</span></button>
    <button type="button" className="ui-pref-reset" onClick={reset} title="恢复默认界面设置"><RotateCcw size={13} /><span>重置</span></button>
  </div>;
}
