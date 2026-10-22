// 拆分：纯工具栏选择器（可整条删） vs 混合规则（需选择器手术）
import { readFileSync, writeFileSync } from 'node:fs';

const list = JSON.parse(readFileSync('docs/gates/toolbar-remove-list.json', 'utf8'));

// 属于其它族的类名：出现在选择器里就不该整条删
const OTHER_FAMILY = /\.field\b|\.form-stack|\.panel-heading|\.data-table|\.form-|\.select-control/;

const pure = [];
const mixed = [];

for (const item of list) {
  const parts = item.sel.split(',').map((s) => s.trim());
  const bad = parts.filter((p) => OTHER_FAMILY.test(p));
  if (bad.length === 0) {
    pure.push({ ...item, parts });
  } else {
    // 混血：列出该摘掉的和该保留的
    const toolbarParts = parts.filter((p) => !OTHER_FAMILY.test(p));
    mixed.push({ ...item, parts, drop: toolbarParts, keep: bad });
  }
}

console.log(`纯工具栏选择器（可整条删）: ${pure.length} 条\n`);
for (const p of pure) console.log(`  [${p.sheet.replace('.css', '')}] ${p.sel.slice(0, 84)}`);

console.log(`\n混合规则（需手术）: ${mixed.length} 条\n`);
for (const m of mixed) {
  console.log(`  [${m.sheet.replace('.css', '')}] ${m.sel.slice(0, 90)}`);
  console.log(`      含其它族: ${m.keep.join(' , ')}`);
  console.log(`      工具栏部分: ${m.drop.join(' , ') || '(无)'}`);
}

writeFileSync('docs/gates/toolbar-split.json', JSON.stringify({ pure, mixed }, null, 2));
console.log('\n→ docs/gates/toolbar-split.json');
