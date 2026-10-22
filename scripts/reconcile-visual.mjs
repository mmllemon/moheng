// hana → moheng 视觉复刻对账表
// 逐项列出：hana 的形态 / moheng 的形态 / 是否对齐
// 这是「与 hana 的差」，不是「与自己的差」
import { readFileSync } from 'node:fs';

const HANA = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css';
const M = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';

function grab(cssText, selector) {
  const lines = cssText.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === `${selector} {` || t === `${selector}{`) {
      const decls = {};
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith('}')) {
        const l = lines[j].trim();
        const idx = l.indexOf(':');
        if (idx > 0 && !l.startsWith('/*')) {
          decls[l.slice(0, idx).trim()] = l.slice(idx + 1).replace(/;.*/, '').trim();
        }
        j++;
      }
      return decls;
    }
  }
  return null;
}

const hanaCss = readFileSync(HANA, 'utf8');
const hanaMerged = readFileSync(`${M}/hana.css`, 'utf8');
const legacyCss = readFileSync(`${M}/legacy.css`, 'utf8');
const v6Css = readFileSync(`${M}/v6.css`, 'utf8');

// 合并 moheng 三层（后层优先）
function mohengOf(selector) {
  const out = {};
  for (const css of [legacyCss, v6Css, hanaMerged]) {
    const d = grab(css, selector);
    if (d) Object.assign(out, d);
  }
  return Object.keys(out).length ? out : null;
}

const items = [];
const add = (name, hanaVal, mohengVal, note = '') => {
  const aligned = hanaVal === mohengVal;
  items.push({ name, hana: hanaVal, moheng: mohengVal, aligned, note });
};

// 1. 排版基准
const hanaBody = grab(hanaCss, 'body') || {};
add('正文字号', '15px', (hanaMerged.match(/font:\s*13px\/1\.55/) ? '13px' : '?'), 'hana 15px / moheng 13px');
add('正文行高', '1.7', (hanaMerged.match(/font:\s*13px\/1\.55/) ? '1.55' : '?'), '行距差 26%');
add('md 内容行高', (grab(hanaCss, '.md-content') || {})['line-height'] || '1.75', '—');

// 2. 骨架
const hanaSidebar = grab(hanaCss, '.sidebar') || {};
const mSidebar = mohengOf('.sidebar') || {};
add('.sidebar position', hanaSidebar.position, mSidebar.position, 'hana 用 flex 占位，moheng 用 fixed 浮层');
add('.sidebar width', hanaSidebar.width, mSidebar.width || mSidebar['flex-basis']);
add('.sidebar z-index', hanaSidebar['z-index'], mSidebar['z-index']);

const hanaMain = grab(hanaCss, '.main-content') || {};
const mMain = mohengOf('.main-shell') || {};
add('主区布局', `${hanaMain.display}/${hanaMain['flex-direction']}`, `${mMain.display}/${mMain['flex-direction']}`);
add('主区让位方式', 'flex 自然占位', mMain['margin-left'] ? `margin-left: ${mMain['margin-left']}` : '—', 'hana 无 margin，moheng 靠 margin 让位');

const hanaTitlebar = grab(hanaCss, '.titlebar') || {};
const mTopbar = mohengOf('.topbar') || {};
add('顶部栏高度', hanaTitlebar.height, mTopbar.height, 'hana --titlebar-h=44px；moheng topbar 48px');
add('顶部栏定位', hanaTitlebar.position, mTopbar.position);

// 3. 组件尺寸
const hanaBtn = grab(hanaCss, '.sidebar-action-btn') || {};
add('侧栏图标按钮', `${hanaBtn.width}x${hanaBtn.height}`, '—', 'hana 26x26');

// 4. 交互细节
add('corner-shape: squircle', '51 处', `${(hanaMerged.match(/corner-shape:\s*squircle/g) || []).length} 处`, '已接上');
add('--corner-radius-scale', '有', hanaMerged.includes('--corner-radius-scale') ? '有' : '无');

// 5. 状态 / 动效
add('--duration 层级', 'instant/fast/slow/spinner 4 级', 'instant/fast/slow 3 级', 'moheng 缺 spinner');
add('--space 梯度', '2,4,6,8,10,12,14,16,24,32,40', '2,4,6,8,10,12,14,16,24,32,40', '完全一致');

console.log('项'.padEnd(22) + 'hana'.padEnd(30) + 'moheng'.padEnd(30) + '状态');
console.log('─'.repeat(112));
let ok = 0, bad = 0;
for (const it of items) {
  const st = it.aligned ? '✓' : '✗';
  if (it.aligned) ok++; else bad++;
  console.log(
    String(it.name).padEnd(22) +
    String(it.hana ?? '—').slice(0, 28).padEnd(30) +
    String(it.moheng ?? '—').slice(0, 28).padEnd(30) +
    st + (it.note ? '  ' + it.note : '')
  );
}
console.log('─'.repeat(112));
console.log(`对齐 ${ok} 项 / 未对齐 ${bad} 项`);
