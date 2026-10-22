import { RotateCcw } from 'lucide-react';
import AppIcon from '../components/AppIcon';
import { PageHeader } from '../components/Ui';
import { APP_ICON_IDS, APP_ICON_PALETTES } from '../lib/app-icon';
import { toast } from '../lib/toast';
import {
  CONTENT_CONTRAST_LEVELS,
  PAPER_TEXTURE_STRENGTHS,
  useUiStore,
  type PaperTextureStyle,
  type UiHeadingFont,
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

const headingFonts: Array<{ value: UiHeadingFont; label: string; note: string; family: string }> = [
  { value: 'serif', label: '思源宋体', note: '稳重，适合经营标题', family: 'var(--font-serif)' },
  { value: 'sans', label: '系统黑体', note: '清晰，适合高密度页面', family: 'var(--font-ui)' },
  { value: 'latin', label: '光谱衬线', note: '西文与数字标题', family: '"MH Serif", Georgia, "Noto Serif SC", serif' },
];

export default function AppearanceSettingsPage() {
  const theme = useUiStore((state) => state.theme);
  const density = useUiStore((state) => state.density);
  const reduceMotion = useUiStore((state) => state.reduceMotion);
  const pageWidth = useUiStore((state) => state.pageWidth);
  const setPageWidth = useUiStore((state) => state.setPageWidth);
  const paperTexture = useUiStore((state) => state.paperTexture);
  const paperTextureStrength = useUiStore((state) => state.paperTextureStrength);
  const headingFont = useUiStore((state) => state.headingFont);
  const contentContrast = useUiStore((state) => state.contentContrast);
  const appIcon = useUiStore((state) => state.appIcon);
  const setTheme = useUiStore((state) => state.setTheme);
  const setDensity = useUiStore((state) => state.setDensity);
  const toggleReduceMotion = useUiStore((state) => state.toggleReduceMotion);
  const setPaperTexture = useUiStore((state) => state.setPaperTexture);
  const setPaperTextureStrength = useUiStore((state) => state.setPaperTextureStrength);
  const setHeadingFont = useUiStore((state) => state.setHeadingFont);
  const setContentContrast = useUiStore((state) => state.setContentContrast);
  const setAppIcon = useUiStore((state) => state.setAppIcon);
  const reset = useUiStore((state) => state.resetUiPreferences);
  const strengthIndex = Math.max(0, PAPER_TEXTURE_STRENGTHS.indexOf(paperTextureStrength as (typeof PAPER_TEXTURE_STRENGTHS)[number]));
  const contrastIndex = Math.max(0, CONTENT_CONTRAST_LEVELS.indexOf(contentContrast));
  const headingFontFamily = headingFonts.find((font) => font.value === headingFont)?.family ?? 'var(--font-serif)';

  return <div className="page-wrap appearance-settings-page">
    <PageHeader title="界面" subtitle="调整主题、纸张质感与工作区显示。设置只影响当前浏览器。" />
    <section className="settings-section" aria-labelledby="appearance-theme-title">
      <h2 id="appearance-theme-title">主题与外观</h2>
      <div className="settings-card">
        <div className="settings-row">
          <div className="settings-row-copy"><strong>主题</strong><span>选择纸张底色与侧栏墨色；只影响当前浏览器。</span></div>
          <div className="settings-segment appearance-theme-segment" role="radiogroup" aria-label="主题">
            {themes.map((choice) => <button key={choice.value} type="button" className={theme === choice.value ? 'is-active' : ''} role="radio" aria-checked={theme === choice.value} onClick={() => setTheme(choice.value)}><i className="appearance-theme-dot" style={{ background: choice.bg }} />{choice.label}</button>)}
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>应用图标</strong><span>浏览器页签图标会同步更新。</span></div>
          <div className="appearance-icon-row" role="group" aria-label="应用图标">
            {APP_ICON_IDS.map((id) => <button key={id} type="button" className={`appearance-icon-choice ${appIcon === id ? 'is-active' : ''}`} aria-pressed={appIcon === id} title={APP_ICON_PALETTES[id].note} onClick={() => setAppIcon(id)}><AppIcon id={id} className="appearance-icon-preview" /><span>{APP_ICON_PALETTES[id].label}</span></button>)}
            <button type="button" className="settings-inline-reset" disabled={appIcon === 'ink'} onClick={() => setAppIcon('ink')}>恢复默认</button>
          </div>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy"><strong>标题字体</strong><span>用于页面标题、卡片标题与数字标题。</span></div>
          <div className="settings-segment" role="radiogroup" aria-label="标题字体">
            {headingFonts.map((font) => <button key={font.value} type="button" className={headingFont === font.value ? 'is-active' : ''} role="radio" aria-checked={headingFont === font.value} style={{ fontFamily: font.family }} onClick={() => setHeadingFont(font.value)}>{font.label}</button>)}
          </div>
        </div>
        <div className="appearance-font-sample settings-font-sample" style={{ fontFamily: headingFontFamily }} aria-hidden="true">账目有据，经营有度。 <span>MOHENG 2026</span></div>
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
          <div className="settings-row-copy"><strong>字体对比度</strong><span>如果看着感觉累，可以调整这个滑块。</span></div>
          <div className="settings-step-slider">
            <input type="range" min="0" max="4" step="1" value={contrastIndex} aria-label="字体对比度" aria-valuetext={`${CONTENT_CONTRAST_LEVELS[contrastIndex]} 档`} onChange={(event) => setContentContrast(CONTENT_CONTRAST_LEVELS[Number(event.target.value)] ?? '13')} />
            <div className="settings-step-rail contrast-rail" aria-hidden="true">
              {CONTENT_CONTRAST_LEVELS.map((level, index) => <span key={level} className={index <= contrastIndex ? 'is-on' : ''} style={{ ['--contrast-bar-h' as string]: `${1.5 + index * 1.4}px` }} />)}
            </div>
            <div className="settings-step-labels"><span /><span>{CONTENT_CONTRAST_LEVELS[contrastIndex]}</span><span /></div>
          </div>
        </div>
        <div className="appearance-contrast-sample" aria-hidden="true">永和九年，岁在癸丑。</div>
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
          <div className="settings-row-copy"><strong>内容宽度</strong><span>控制页面正文的最大宽度，对齐 Hana 的阅读宽度四档。</span></div>
          <div className="settings-width-choice" role="radiogroup" aria-label="内容宽度">
            {([['640', '640'], ['720', '720'], ['800', '800'], ['unlimited', '不限']] as const).map(([value, label]) => (
              <button key={value} type="button" role="radio" aria-checked={pageWidth === value} className={`settings-width-option ${pageWidth === value ? 'is-active' : ''}`} onClick={() => setPageWidth(value)}>{label}</button>
            ))}
          </div>
        </div>
      </div>
    </section>

    <div className="settings-page-foot">
      <span>纸纹取自 Hana 1.1.35 原版素材。</span>
      <button type="button" className="settings-reset" onClick={() => { reset(); toast('已恢复默认显示', { description: '暖纸 · 宣纸 · 舒朗 · 宋体 · 墨夜' }); }}><RotateCcw size={12} />恢复默认</button>
    </div>
  </div>;
}
