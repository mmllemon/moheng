// 按钮高度收敛：把不在档位的值归到最近档位
// Hana 档位：20 / 22 / 24 / 26 / 28 / 30 / 32 / 34
// 只处理按钮/控件类选择器的 height / min-height
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const DRY = !process.argv.includes('--write');

// 允许的档位
const TIERS = [20, 22, 24, 26, 28, 30, 32, 34];
// 明确映射：偏离档位的值 → 目标档位
// 30→32 是主动提升主力档位；其余就近
const MAP = {
  25: 26, 27: 28, 29: 30, 31: 32, 33: 34, 35: 36,
  36: 36, 37: 36, 38: 38, 40: 40, 44: 44, 48: 48,
  30: 32, // 主力档位提升
};
// 这些是容器/大块，不是控件，跳过
const SKIP_MIN = 50;

// 按钮/控件选择器特征
const CONTROL_RE = /btn|button|btn-|icon-button|action|toggle|chip|badge|tab|nav-link|trigger|switch|select|input|field|control|toolbar/i;
// 安全阀：这些是隐藏的测量元素或原生表单元素，尺寸不可动
const NEVER_RESIZE = /proxy|hidden|sr-only|radio|checkbox|separator|divider|spacer/i;

const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);
const changes = [];
const skipped = [];
let inBlock = false;
let selector = '';

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const t = raw.trim();

  if (!inBlock) {
    if (t.endsWith('{') && !t.startsWith('@') && !t.startsWith('/*')) {
      inBlock = true;
      selector = t.slice(0, -1).trim();
    }
    continue;
  }
  if (t === '}') { inBlock = false; continue; }
  if (!t.includes(':') || !t.endsWith(';')) continue;

  const idx = t.indexOf(':');
  const prop = t.slice(0, idx).trim();
  if (prop !== 'height' && prop !== 'min-height') continue;

  const rawVal = t.slice(idx + 1).replace(/;$/, '').trim();
  const important = /!important/.test(rawVal);
  const val = rawVal.replace(/\s*!important/, '').trim();

  // 只处理纯 px
  const m = val.match(/^(\d+)px$/);
  if (!m) continue;
  const n = parseInt(m[1], 10);

  // 大块跳过
  if (n >= SKIP_MIN) { skipped.push({ line: i + 1, selector, prop, value: val, reason: 'container-size' }); continue; }
  // 已在档位
  if (TIERS.includes(n)) continue;
  // 不可改的隐藏/原生元素
  if (NEVER_RESIZE.test(selector)) { skipped.push({ line: i + 1, selector, prop, value: val, reason: 'never-resize' }); continue; }
  // 极小值（≤4px）是隐藏元素或分隔线
  if (n <= 4) { skipped.push({ line: i + 1, selector, prop, value: val, reason: 'tiny-hidden' }); continue; }
  // 非控件选择器跳过
  if (!CONTROL_RE.test(selector)) { skipped.push({ line: i + 1, selector, prop, value: val, reason: 'not-control' }); continue; }

  const target = MAP[n] ?? TIERS.reduce((best, tier) => Math.abs(tier - n) < Math.abs(best - n) ? tier : best, TIERS[0]);
  if (target === n) continue;

  const indent = raw.match(/^\s*/)[0];
  lines[i] = `${indent}${prop}: ${target}px${important ? ' !important' : ''};`;
  changes.push({ line: i + 1, selector: selector.slice(0, 46), prop, before: n, after: target });
}

if (!DRY) writeFileSync(FILE, lines.join('\n'), 'utf8');

const tally = {};
for (const c of changes) {
  const k = `${c.before} → ${c.after}`;
  tally[k] = (tally[k] || 0) + 1;
}

console.log(`${DRY ? 'DRY-RUN' : 'WRITTEN'}: ${changes.length} declarations`);
console.log('\n=== 映射统计 ===');
for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(14)} ${n}`);
console.log('\n=== 前 30 条 ===');
for (const c of changes.slice(0, 30)) console.log(`L${String(c.line).padEnd(6)} ${c.selector.padEnd(48)} ${c.prop}: ${c.before}px → ${c.after}px`);
console.log(`\n跳过 ${skipped.length} 处`);
for (const s of skipped.slice(0, 10)) console.log(`  L${s.line} ${s.selector.slice(0, 40)} ${s.prop}:${s.value} [${s.reason}]`);
