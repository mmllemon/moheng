// 按 Hana 布局准则批量修正裸 px 间距 → token
// 映射规则：就近对齐到最近的允许 token（2/4/6/8/10/12/14/16/24/32/40）
// 安全阀：
//   - 只处理单值或纯间距多值；跳过含布局尺寸的声明（如 margin-left: 246px）
//   - 跳过绝对值 > 40px 的值（那是尺寸，不是间距）
//   - margin-left/right 用作布局偏移时不处理
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const DRY = !process.argv.includes('--write');

// 允许的 token 值 → 变量名
const TOKEN_BY_PX = {
  2: 'var(--space-2)', 4: 'var(--space-4)', 6: 'var(--space-6)', 8: 'var(--space-8)',
  10: 'var(--space-10)', 12: 'var(--space-12)', 14: 'var(--space-14)', 16: 'var(--space-16)',
  24: 'var(--space-24)', 32: 'var(--space-32)', 40: 'var(--space-40)',
};
const ALLOWED = new Set(Object.keys(TOKEN_BY_PX).map(Number));
const MAX_SPACING = 40; // 超过这个值视为尺寸，不是间距

// 特殊映射：这些值不在 Hana 的 8 个 token 里，但是常见的"区块留白"，
// 向上对齐到更大一级，保持呼吸感（而不是向下压缩）
const PREFER_UP = { 18: 24, 20: 24, 22: 24, 26: 32, 28: 32, 30: 32 };

function nearestToken(v) {
  const n = Math.abs(v);
  if (PREFER_UP[n]) return PREFER_UP[n];
  let best = null;
  let bestDist = Infinity;
  for (const t of ALLOWED) {
    const d = Math.abs(t - n);
    if (d < bestDist) { bestDist = d; best = t; }
  }
  return best;
}

let src = readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

const SPACING_PROPS = /^(margin|padding|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/;

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
  if (!SPACING_PROPS.test(prop)) continue;

  const rawVal = t.slice(idx + 1).replace(/;$/, '').trim();
  const important = /!important/.test(rawVal);
  const val = rawVal.replace(/\s*!important/, '').trim();

  if (!/\d+px/.test(val)) continue;

  // 安全阀 1：含超过 40px 的值 → 尺寸，跳过
  const pxNums = [...val.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => Math.abs(parseFloat(m[1])));
  if (pxNums.some((n) => n > MAX_SPACING)) {
    skipped.push({ line: i + 1, selector, prop, value: val, reason: 'exceeds-spacing-range' });
    continue;
  }

  // 安全阀 2：margin-left/right 单独用作布局偏移（值 > 32）→ 跳过
  if (/^margin-(left|right)$/.test(prop) && pxNums.some((n) => n > 32)) {
    skipped.push({ line: i + 1, selector, prop, value: val, reason: 'layout-offset' });
    continue;
  }

  let changed = false;
  const newVal = val.replace(/(-?\d*\.?\d+)px/g, (m, numStr) => {
    const n = parseFloat(numStr);
    const target = ALLOWED.has(Math.abs(n)) ? Math.abs(n) : nearestToken(n);
    if (target === null) return m;
    changed = true;
    const tok = TOKEN_BY_PX[target];
    return n < 0 ? `calc(-1 * ${tok})` : tok;
  });

  if (changed) {
    const indent = raw.match(/^\s*/)[0];
    lines[i] = `${indent}${prop}: ${newVal}${important ? ' !important' : ''};`;
    changes.push({ line: i + 1, selector, prop, before: val, after: newVal });
  }
}

if (!DRY) {
  writeFileSync(FILE, lines.join('\n'), 'utf8');
}

console.log(`${DRY ? 'DRY-RUN' : 'WRITTEN'}: ${changes.length} declarations, ${skipped.length} skipped`);
console.log('\n=== 跳过（安全阀）===');
for (const s of skipped.slice(0, 15)) {
  console.log(`L${String(s.line).padEnd(6)} ${s.selector.slice(0, 30).padEnd(32)} ${s.prop}: ${s.value}  [${s.reason}]`);
}
console.log('\n=== 前 25 条改动 ===');
for (const c of changes.slice(0, 25)) {
  console.log(`L${String(c.line).padEnd(6)} ${c.selector.slice(0, 30).padEnd(32)} ${c.prop}: ${c.before}  →  ${c.after}`);
}

// 汇总映射
const map = {};
for (const c of changes) {
  const key = `${c.before}  →  ${c.after}`;
  map[key] = (map[key] || 0) + 1;
}
console.log('\n=== 映射统计 ===');
for (const [k, n] of Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${k.padEnd(50)} ${n}`);
}
