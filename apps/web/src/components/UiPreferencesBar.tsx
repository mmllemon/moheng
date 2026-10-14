import { useEffect } from 'react';
import { Check, LayoutDashboard, Monitor, Palette, RotateCcw, SlidersHorizontal, Type, Zap } from 'lucide-react';
import { useUiStore } from '../auth-store';

const themeChoices = [
  { value: 'ivory' as const, label: '象牙雅白', short: '象牙', swatch: 'theme-swatch-ivory' },
  { value: 'champagne' as const, label: '香槟曜金', short: '曜金', swatch: 'theme-swatch-champagne' },
  { value: 'obsidian' as const, label: '黑曜极光', short: '黑曜', swatch: 'theme-swatch-obsidian' },
  { value: 'glacier' as const, label: '冰川天青', short: '冰川', swatch: 'theme-swatch-glacier' },
];

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
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolved = theme === 'system' ? (media?.matches ? 'obsidian' : 'ivory') : theme;
      root.dataset.theme = resolved === 'obsidian' ? 'dark' : 'light';
      root.dataset.themeName = resolved;
      root.dataset.themePreference = theme;
      root.dataset.density = density;
      root.dataset.accent = accent;
      root.dataset.motion = reduceMotion ? 'reduced' : 'full';
      root.dataset.contentWidth = wideContent ? 'wide' : 'standard';
    };
    applyTheme();
    if (theme !== 'system' || !media) return;
    media.addEventListener?.('change', applyTheme);
    return () => media.removeEventListener?.('change', applyTheme);
  }, [theme, density, accent, reduceMotion, wideContent]);

  return <div className="ui-preferences-bar" aria-label="界面设置">
    <div className="ui-pref-section ui-pref-themes">
      <span className="ui-pref-label"><Palette size={13} />主题</span>
      <div className="ui-theme-dial" role="group" aria-label="材质主题">
        {themeChoices.map((choice) => <button key={choice.value} type="button" className={`ui-theme-choice ${theme === choice.value ? 'active' : ''}`} aria-label={choice.label} aria-pressed={theme === choice.value} title={choice.label} onClick={() => setTheme(choice.value)}>
          <span className={`theme-swatch ${choice.swatch}`}>{theme === choice.value && <Check size={10} />}</span><span>{choice.short}</span>
        </button>)}
        <button type="button" className={`ui-theme-choice ui-system-theme ${theme === 'system' ? 'active' : ''}`} aria-label="跟随系统主题" aria-pressed={theme === 'system'} title="跟随系统主题" onClick={() => setTheme('system')}>
          <span className="theme-swatch theme-swatch-system"><Monitor size={10} /></span><span>系统</span>
        </button>
      </div>
    </div>
    <span className="ui-pref-divider" />
    <div className="ui-pref-section"><span className="ui-pref-label"><Type size={13} />密度</span><div className="ui-segmented ui-segmented-small" role="group" aria-label="界面密度"><button type="button" className={density === 'comfortable' ? 'active' : ''} aria-pressed={density === 'comfortable'} onClick={() => setDensity('comfortable')}>舒朗</button><button type="button" className={density === 'compact' ? 'active' : ''} aria-pressed={density === 'compact'} onClick={() => setDensity('compact')}>紧凑</button></div></div>
    <span className="ui-pref-divider" />
    <div className="ui-pref-section"><span className="ui-pref-label">强调色</span><div className="ui-accent-palette" role="group" aria-label="强调色">
      <button type="button" className={`ui-accent-dot accent-theme ${accent === 'theme' ? 'active' : ''}`} aria-label="跟随主题色" aria-pressed={accent === 'theme'} title="跟随主题色" onClick={() => setAccent('theme')}>{accent === 'theme' && <Check size={11} />}</button>
      <button type="button" className={`ui-accent-dot accent-indigo ${accent === 'indigo' ? 'active' : ''}`} aria-label="靛青强调色" aria-pressed={accent === 'indigo'} title="靛青强调色" onClick={() => setAccent('indigo')}>{accent === 'indigo' && <Check size={11} />}</button>
      <button type="button" className={`ui-accent-dot accent-jade ${accent === 'jade' ? 'active' : ''}`} aria-label="青玉强调色" aria-pressed={accent === 'jade'} title="青玉强调色" onClick={() => setAccent('jade')}>{accent === 'jade' && <Check size={11} />}</button>
      <button type="button" className={`ui-accent-dot accent-cinnabar ${accent === 'cinnabar' ? 'active' : ''}`} aria-label="朱砂强调色" aria-pressed={accent === 'cinnabar'} title="朱砂强调色" onClick={() => setAccent('cinnabar')}>{accent === 'cinnabar' && <Check size={11} />}</button>
    </div></div>
    <span className="ui-pref-divider ui-pref-divider-optional" />
    <button type="button" className={`ui-pref-toggle ${wideContent ? 'active' : ''}`} aria-pressed={wideContent} onClick={toggleWideContent} title="减少两侧留白，使用宽屏布局"><LayoutDashboard size={14} /><span>宽屏</span></button>
    <button type="button" className={`ui-pref-toggle ${reduceMotion ? 'active' : ''}`} aria-pressed={reduceMotion} onClick={toggleReduceMotion} title="减少页面切换和弹层动画"><Zap size={14} /><span>减少动效</span></button>
    <button type="button" className="ui-pref-reset" onClick={reset} title="恢复默认界面设置"><RotateCcw size={13} /><span>重置</span></button>
  </div>;
}
