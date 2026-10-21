// 查 Hana 的卡片与多列布局体系
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'D:/WorkSpace/hana/hana-seed/renderer';
const files = [];
function walk(d) {
  for (const n of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, n.name);
    if (n.isDirectory()) walk(p);
    else if (n.name.endsWith('.css')) files.push(p);
  }
}
walk(DIR);
let all = '';
for (const f of files) all += readFileSync(f, 'utf8') + '\n';

const rules = [];
for (const m of all.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const decls = {};
  for (const d of m[2].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  if (Object.keys(decls).length) rules.push({ sel: m[1].trim(), decls });
}

// 1. 所有 grid 布局规则 —— 看 Hana 怎么排多列
console.log('===== Hana 的 grid 布局（全部）=====');
const grids = rules.filter((r) => r.decls.display && /grid/.test(r.decls.display) && r.decls['grid-template-columns']);
for (const g of grids) {
  console.log(`\n${g.sel.slice(0, 70)}`);
  console.log(`  cols: ${g.decls['grid-template-columns'].slice(0, 90)}`);
  if (g.decls.gap) console.log(`  gap: ${g.decls.gap}`);
  if (g.decls['grid-auto-rows']) console.log(`  rows: ${g.decls['grid-auto-rows']}`);
}
console.log(`\n共 ${grids.length} 条 grid 规则`);

// 2. 卡片类规则
console.log('\n\n===== 卡片类（card / metric / stat / tile）=====');
const cardRe = /card|metric|stat|tile|kpi|summary|_panel_|surface/i;
const cards = rules.filter((r) => cardRe.test(r.sel) && (r.decls.padding || r.decls.background || r.decls['border-radius']));
for (const c of cards.slice(0, 30)) {
  const keep = {};
  for (const k of ['display', 'padding', 'gap', 'background', 'border', 'border-radius', 'box-shadow', 'min-width', 'grid-template-columns', 'flex-direction']) {
    if (c.decls[k]) keep[k] = c.decls[k];
  }
  if (Object.keys(keep).length) {
    console.log(`  ${c.sel.slice(0, 60)}`);
    console.log(`    ${JSON.stringify(keep)}`);
  }
}

// 3. 统计数字的排版
console.log('\n\n===== 数字/大数值排版（font-variant-numeric / 大字号）=====');
for (const r of rules) {
  const fs = r.decls['font-size'];
  const fvn = r.decls['font-variant-numeric'];
  if (fvn || (fs && /^(1[6-9]|2[0-9]|3[0-9]|4[0-9])px$|^1\.[2-9]rem$|^[2-3]rem$/.test(fs))) {
    if (/metric|stat|num|value|count|amount|figure|_num|big/i.test(r.sel)) {
      console.log(`  ${r.sel.slice(0, 60)}  fs=${fs} fvn=${fvn || '-'} fw=${r.decls['font-weight'] || '-'} lh=${r.decls['line-height'] || '-'}`);
    }
  }
}
