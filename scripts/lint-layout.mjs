// 布局准则 lint：检查 hana.css 是否违反 docs/Hana布局准则.md
// 三类违规：裸 px 间距 / 非法控件高度 / margin 堆叠
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = process.argv[2] ?? 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const OUT = process.argv[3] ?? 'D:/WorkSpace/hana/moheng/docs/gates/lint-layout.json';

const src = readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

// 允许的间距 token
const SPACE_TOKENS = ['--space-2', '--space-4', '--space-6', '--space-8', '--space-10',
  '--space-12', '--space-14', '--space-16', '--space-24', '--space-32', '--space-40'];
const ALLOWED_SPACE_PX = new Set([0, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 24, 32, 40, 48, 64, 80, 96, 100]);

// 控件高度白名单
const ALLOWED_HEIGHTS = new Set([14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 44, 48]);
// 注意：准则说三档，但图标/头像容器是另一类。lint 只报"看起来像控件但不在三档内"的

const violations = { bareSpacing: [], badHeight: [], marginStacking: [], summary: {} };

let inBlock = false;
let blockStart = 0;
let selector = '';
let blockDecls = [];

function flushBlock() {
  if (!blockDecls.length) return;
  // 1. 裸 px 间距
  for (const d of blockDecls) {
    if (/^(margin|padding|gap|row-gap|column-gap)(-top|-right|-bottom|-left)?$/.test(d.prop)) {
      if (!d.value.includes('var(') && !d.value.includes('auto') && d.value !== '0') {
        const pxValues = [...d.value.matchAll(/(-?\d*\.?\d+)px/g)].map((m) => Number(m[1]));
        const bad = pxValues.filter((v) => !ALLOWED_SPACE_PX.has(Math.abs(v)));
        if (bad.length) {
          violations.bareSpacing.push({ line: d.line, selector, prop: d.prop, value: d.value, badValues: bad });
        }
      }
      // 也检查 var() 里是否用了非法 token
      const tokens = [...d.value.matchAll(/var\((--space-[\w-]+)\)/g)].map((m) => m[1]);
      const badTokens = tokens.filter((t) => !SPACE_TOKENS.includes(t));
      if (badTokens.length) {
        violations.bareSpacing.push({ line: d.line, selector, prop: d.prop, value: d.value, badTokens });
      }
    }
    // 2. 控件高度
    if (d.prop === 'height' && /^\d+px$/.test(d.value)) {
      const v = parseInt(d.value, 10);
      if (!ALLOWED_HEIGHTS.has(v)) {
        violations.badHeight.push({ line: d.line, selector, prop: 'height', value: d.value });
      }
    }
  }
  // 3. margin 堆叠：块内有 > * + * 或 > *:not(:last-child) 且用 margin
  const hasMarginStack = blockDecls.some((d) => /^margin(-top|-bottom)?$/.test(d.prop) && d.value !== '0');
  const isAdjacentSelector = /\+|\*|~/.test(selector);
  if (hasMarginStack && isAdjacentSelector) {
    violations.marginStacking.push({ line: blockStart, selector, note: '相邻选择器用 margin 制造间距，建议改用容器 gap' });
  }

  blockDecls = [];
}

for (let i = 0; i < lines.length; i++) {
  const raw = lines[i];
  const t = raw.trim();
  if (!inBlock) {
    if (t.endsWith('{') && !t.startsWith('@') && !t.startsWith('/*')) {
      inBlock = true;
      blockStart = i + 1;
      selector = t.slice(0, -1).trim();
      blockDecls = [];
    }
  } else {
    if (t === '}') {
      flushBlock();
      inBlock = false;
    } else if (t.includes(':') && t.endsWith(';')) {
      const idx = t.indexOf(':');
      const prop = t.slice(0, idx).trim();
      const value = t.slice(idx + 1).replace(/;$/, '').trim().replace(/\s*!important$/, '');
      blockDecls.push({ prop, value, line: i + 1 });
    }
  }
}

// 统计
const pxDecls = [...src.matchAll(/-?\d+px/g)].length;
const varDecls = [...src.matchAll(/var\(--/g)].length;

violations.summary = {
  totalLines: lines.length,
  pxOccurrences: pxDecls,
  varOccurrences: varDecls,
  tokenRatio: +(varDecls / (pxDecls + varDecls) * 100).toFixed(1),
  bareSpacing: violations.bareSpacing.length,
  badHeight: violations.badHeight.length,
  marginStacking: violations.marginStacking.length,
};

// 按频次排序最常违规的值
const badSpacingFreq = {};
for (const v of violations.bareSpacing) {
  for (const b of v.badValues ?? []) badSpacingFreq[b + 'px'] = (badSpacingFreq[b + 'px'] || 0) + 1;
  for (const b of v.badTokens ?? []) badSpacingFreq[b] = (badSpacingFreq[b] || 0) + 1;
}
const topBadSpacing = Object.entries(badSpacingFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);

writeFileSync(OUT, JSON.stringify({ ...violations, topBadSpacing }, null, 2), 'utf8');

console.log('=== 汇总 ===');
console.log(JSON.stringify(violations.summary, null, 1));
console.log('\n=== 最常见的违规间距值 ===');
for (const [v, n] of topBadSpacing) console.log(`  ${String(v).padEnd(14)} ${n} 次`);
console.log('\n=== 违规样例（间距，前 15）===');
for (const v of violations.bareSpacing.slice(0, 15)) {
  console.log(`  L${v.line} ${v.selector.slice(0, 42)}  ${v.prop}: ${v.value}`);
}
console.log('\n=== 违规样例（高度，前 10）===');
for (const v of violations.badHeight.slice(0, 10)) {
  console.log(`  L${v.line} ${v.selector.slice(0, 42)}  height: ${v.value}`);
}
