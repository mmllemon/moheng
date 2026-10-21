import { type CSSProperties } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { PageHeader } from '../components/Ui';
import { toast } from '../lib/toast';
import {
  PAPER_TEXTURE_STRENGTHS,
  useUiStore,
  type PaperTextureStyle,
  type UiTheme,
} from '../auth-store';

const themes: Array<{ value: UiTheme; label: string; note: string; bg: string; sidebar: string; card: string }> = [
  { value: 'warm-paper', label: '暖纸', note: 'Hana 默认纸面', bg: '#f8f4ed', sidebar: '#f4f0ea', card: '#fcfaf5' },
  { value: 'plain-white', label: '素白', note: '高对比、清透', bg: '#fbfaf7', sidebar: '#f3f1ec', card: '#ffffff' },
  { value: 'midnight', label: '青夜', note: '低光夜间', bg: '#26343d', sidebar: '#202c34', card: '#30414b' },
];

const textures: Array<{ value: PaperTextureStyle; label: string }> = [
  { value: 'off', label: '关闭' },
  { value: 'rice', label: '宣纸' },
  { value: 'cotton', label: '棉纸' },
  { value: 'fine', label: '细颗粒' },
];

export default function AppearanceSettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const reduceMotion = useUiStore((state) => state.reduceMotion);
  const wideContent = useUiStore((state) => state.wideContent);
  const paperTexture = useUiStore((state) => state.paperTexture);
  const paperTextureStrength = useUiStore((state) => state.paperTextureStrength);
  const setTheme = useUiStore((state) => state.setTheme);
  const setDensity = useUiStore((state) => state.setDensity);
  const toggleReduceMotion = useUiStore((state) => state.toggleReduceMotion);
  const toggleWideContent = useUiStore((state) => state.toggleWideContent);
  const setPaperTexture = useUiStore((state) => state.setPaperTexture);
  const setPaperTextureStrength = useUiStore((state) => state.setPaperTextureStrength);
  const reset = useUiStore((state) => state.resetUiPreferences);
  const strengthIndex = Math.max(0, PAPER_TEXTURE_STRENGTHS.indexOf(paperTextureStrength as (typeof PAPER_TEXTURE_STRENGTHS)[number]));

  return <div className="page-wrap appearance-settings-page">
    <PageHeader title="界面" subtitle="调整主题、纸张质感与工作区显示。设置只影响当前浏览器。" />
    <section className="settings-section" aria-labelledby="appearance-theme-title">
      <h2 id="appearance-theme-title">主题</h2>
      <div className="settings-theme-grid" role="group" aria-label="主题">
        {themes.map((choice) => <button
          key={choice.value}
          type="button"
          className={`settings-theme-card ${theme === choice.value ? 'is-active' : ''}`}
          data-theme={choice.value}
          aria-pressed={theme === choice.value}
          onClick={() => setTheme(choice.value)}
        >
          <span className="settings-theme-swatch" style={{ '--theme-bg': choice.bg, '--theme-sidebar': choice.sidebar, '--theme-card': choice.card } as CSSProperties} />
          <span className="settings-theme-copy"><strong>{choice.label}</strong><small>{choice.note}</small></span>
          <span className="settings-theme-check">{theme === choice.value && <Check size={13} />}</span>
        </button>)}
      </div>
    </section>

    <section className="settings-section" aria-labelledby="appearance-surface-title">
      <h2 id="appearance-surface-title">外观</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-copy"><strong>纸质纹理</strong><span>为页面、侧栏和设置页加上纸张质感。</span></div>
          <div className="settings-segment" role="radiogroup" aria-label="纸质纹理">
            {textures.map((choice) => <button key={choice.value} type="button" className={paperTexture === choice.value ? 'is-active' : ''} role="radio" aria-checked={paperTexture === choice.value} onClick={() => setPaperTexture(choice.value)}>{choice.label}</button>)}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>纹理强度</strong><span>1 最轻，5 最明显；只改变纸面明暗差。</span></div>
          <div className={`settings-step-slider ${paperTexture === 'off' ? 'is-disabled' : ''}`}>
            <input type="range" min="0" max="4" step="1" value={strengthIndex} disabled={paperTexture === 'off'} aria-label="纹理强度" aria-valuetext={`${strengthIndex + 1} 档`} onChange={(event) => setPaperTextureStrength(PAPER_TEXTURE_STRENGTHS[Number(event.target.value)] ?? 1)} />
            <div className="settings-step-rail" aria-hidden="true">
              {[0, 1, 2, 3].map((step) => <span key={step} className={step < strengthIndex ? 'is-on' : ''} />)}
            </div>
            <div className="settings-step-labels"><span>1</span><span>{strengthIndex + 1}</span><span>5</span></div>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>减少动效</strong><span>保留状态反馈，关闭位移与弹性动画。</span></div>
          <button type="button" className={`settings-toggle ${reduceMotion ? 'is-on' : ''}`} role="switch" aria-checked={reduceMotion} aria-label="减少动效" onClick={toggleReduceMotion}><i /></button>
        </div>
      </div>
    </section>

    <section className="settings-section" aria-labelledby="appearance-workspace-title">
      <h2 id="appearance-workspace-title">工作区</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-copy"><strong>信息密度</strong><span>调整表格和表单的行距。</span></div>
          <div className="settings-segment" role="radiogroup" aria-label="信息密度">
            <button type="button" className={density === 'comfortable' ? 'is-active' : ''} role="radio" aria-checked={density === 'comfortable'} onClick={() => setDensity('comfortable')}>舒朗</button>
            <button type="button" className={density === 'compact' ? 'is-active' : ''} role="radio" aria-checked={density === 'compact'} onClick={() => setDensity('compact')}>紧凑</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>宽屏内容</strong><span>减少两侧留白，显示更多业务列。</span></div>
          <button type="button" className={`settings-toggle ${wideContent ? 'is-on' : ''}`} role="switch" aria-checked={wideContent} aria-label="宽屏内容" onClick={toggleWideContent}><i /></button>
        </div>
      </div>
    </section>

    <div className="settings-page-foot">
      <span>纸纹取自 Hana 1.1.35 原版素材。</span>
      <button type="button" className="settings-reset" onClick={() => { reset(); toast('已恢复默认显示', { description: '暖纸 · 宣纸 · 舒朗' }); }}><RotateCcw size={12} />恢复默认</button>
    </div>
  </div>;
}
