// 从 Hana 压缩 CSS 中提取设计模式：布局、间距、尺寸的分布规律
// 这能回答"为什么 Hana 看起来舒服"——不是某个值，而是值的分布方式
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'D:/WorkSpace/hana/hana-seed/renderer';
const OUT = 'D:/WorkSpace/hana/moheng/docs/gates/hana-design-patterns.json';

// 收集所有 CSS
const cssFiles = [];
function walk(d) {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (n.isDirectory()) walk(p);
    else if (n.name.endsWith('.css')) cssFiles.push(p);
  }
}
walk(DIR);

let all = '';
for (const f of cssFiles) all += readFileSync(f, 'utf8') + '\n';
console.log('css files:', cssFiles.length, 'total MB:', (all.length / 1e6).toFixed(2));

// 提取所有声明
const decls = [];
for (const m of all.matchAll(/([a-z-]+)\s*:\s*([^;{}]+)/g)) {
  decls.push({ prop: m[1].trim(), value: m[2].trim() });
}
console.log('declarations:', decls.length);

const count = (pred) => {
  const map = {};
  for (const d of decls) if (pred(d)) map[d.value] = (map[d.value] || 0) + 1;
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
};

// 1. gap 的分布 —— 反映"留白节奏"
const gaps = count((d) => d.prop === 'gap');

// 2. padding 的分布
const paddings = count((d) => d.prop === 'padding');

// 3. 高度（控件尺寸）
const heights = count((d) => d.prop === 'height' && /^\d/.test(d.value));

// 4. 字号
const fonts = count((d) => d.prop === 'font-size');

// 5. 行高
const lineHeights = count((d) => d.prop === 'line-height');

// 6. 圆角
const radii = count((d) => d.prop === 'border-radius');

// 7. 布局方式
const displays = count((d) => d.prop === 'display');

// 8. flex 相关
const flexProps = count((d) => d.prop.startsWith('flex'));

// 9. 关键：flex 容器里 gap 的使用率 vs margin
const flexGapUsage = gaps.reduce((a, [, n]) => a + n, 0);
const marginUsage = decls.filter((d) => d.prop.startsWith('margin') && d.value !== '0').length;
const paddingUsage = decls.filter((d) => d.prop.startsWith('padding') && d.value !== '0').length;

const result = {
  cssFiles: cssFiles.length,
  declarations: decls.length,
  topGaps: gaps.slice(0, 15),
  topPaddings: paddings.slice(0, 15),
  topHeights: heights.slice(0, 15),
  topFontSizes: fonts.slice(0, 12),
  topLineHeights: lineHeights.slice(0, 12),
  topRadii: radii.slice(0, 12),
  displayModes: displays.slice(0, 8),
  spacingStrategy: {
    gapDeclarations: flexGapUsage,
    marginDeclarations: marginUsage,
    paddingDeclarations: paddingUsage,
    note: 'gap 多 = 用 gap 排版；margin 多 = 用 margin 排版。前者是现代做法，更整齐',
  },
  flexProps: flexProps.slice(0, 12),
};

writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf8');

console.log('\n=== gap 分布（留白节奏）===');
for (const [v, n] of gaps.slice(0, 12)) console.log(`  ${String(v).padEnd(18)} ${n}`);

console.log('\n=== padding 分布 ===');
for (const [v, n] of paddings.slice(0, 12)) console.log(`  ${String(v).padEnd(22)} ${n}`);

console.log('\n=== 控件高度 ===');
for (const [v, n] of heights.slice(0, 10)) console.log(`  ${String(v).padEnd(14)} ${n}`);

console.log('\n=== 排版策略 ===');
console.log(JSON.stringify(result.spacingStrategy, null, 1));

console.log('\n=== display 分布 ===');
for (const [v, n] of displays.slice(0, 6)) console.log(`  ${String(v).padEnd(14)} ${n}`);
