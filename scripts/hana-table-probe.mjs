// 深度拆解 Hana 的表格设计语言
// 从压缩 CSS 里提取所有表格相关规则，按结构分组
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
  const sel = m[1].trim();
  const decls = {};
  for (const d of m[2].split(';')) {
    const i = d.indexOf(':');
    if (i > 0) decls[d.slice(0, i).trim()] = d.slice(i + 1).trim();
  }
  if (Object.keys(decls).length) rules.push({ sel, decls });
}

// 表格相关：table / thead / tbody / tr / th / td / 表格容器
const TABLE_RE = /(^|[\s>+~,])(table|thead|tbody|tfoot|tr|th|td)\b|_table|table-|_grid_|data-table/i;
const tableRules = rules.filter((r) => TABLE_RE.test(r.sel));
console.log('table-ish rules:', tableRules.length, '/', rules.length);

// 按选择器角色分组
const groups = {
  tableRoot: [], thead: [], tbody: [], tr: [], th: [], td: [], wrapper: [], other: [],
};
for (const r of tableRules) {
  const s = r.sel;
  if (/\bthead\b|\bth\b/.test(s)) groups.thead.push(r);
  else if (/\btbody\b/.test(s)) groups.tbody.push(r);
  else if (/\btr\b/.test(s)) groups.tr.push(r);
  else if (/\btd\b/.test(s)) groups.td.push(r);
  else if (/^table\b|\btable\s*\{|\btable$/.test(s) || /_table_\w+\{/.test(s + '{')) groups.tableRoot.push(r);
  else if (/scroll|wrapper|container|overflow/i.test(s)) groups.wrapper.push(r);
  else groups.other.push(r);
}

const show = (name, arr, keys, limit = 12) => {
  console.log(`\n===== ${name} (${arr.length}) =====`);
  for (const r of arr.slice(0, limit)) {
    const keep = {};
    for (const k of keys) if (r.decls[k] !== undefined) keep[k] = r.decls[k];
    if (!Object.keys(keep).length) continue;
    console.log(`  ${r.sel.slice(0, 64)}`);
    console.log(`    ${JSON.stringify(keep)}`);
  }
};

const BOX = ['display', 'width', 'min-width', 'max-width', 'height', 'min-height', 'padding', 'padding-top', 'padding-bottom', 'padding-left', 'padding-right', 'margin', 'border', 'border-top', 'border-bottom', 'border-left', 'border-radius', 'background', 'box-shadow', 'position', 'overflow', 'table-layout', 'border-collapse', 'border-spacing', 'vertical-align'];
const TYPE = ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-align', 'text-transform', 'color', 'font-variant-numeric', 'white-space', 'text-overflow'];
const STATE = ['transition', 'cursor'];

show('tableRoot', groups.tableRoot, [...BOX, ...TYPE], 10);
show('thead / th', groups.thead, [...BOX, ...TYPE], 14);
show('tbody', groups.tbody, [...BOX, ...TYPE], 8);
show('tr', groups.tr, [...BOX, ...STATE], 12);
show('td', groups.td, [...BOX, ...TYPE], 14);
show('wrapper', groups.wrapper, [...BOX], 8);

// 统计关键属性分布
const tally = (arr, key) => {
  const o = {};
  for (const r of arr) { const v = r.decls[key]; if (v) o[v] = (o[v] || 0) + 1; }
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
};

console.log('\n\n########## 关键分布 ##########');
for (const [label, arr] of [['th', groups.thead], ['td', groups.td], ['tr', groups.tr]]) {
  console.log(`\n--- ${label} padding ---`);
  for (const [v, n] of tally(arr, 'padding').slice(0, 8)) console.log(`  ${String(v).padEnd(38)} ${n}`);
  console.log(`--- ${label} height/min-height ---`);
  for (const [v, n] of [...tally(arr, 'height'), ...tally(arr, 'min-height')].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`  ${String(v).padEnd(24)} ${n}`);
  console.log(`--- ${label} font-size ---`);
  for (const [v, n] of tally(arr, 'font-size').slice(0, 6)) console.log(`  ${String(v).padEnd(24)} ${n}`);
  console.log(`--- ${label} border ---`);
  for (const [v, n] of [...tally(arr, 'border'), ...tally(arr, 'border-bottom'), ...tally(arr, 'border-top')].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${String(v).padEnd(50)} ${n}`);
}

// 找带 hover / selected 状态的表格行
console.log('\n\n########## 交互态 ##########');
for (const r of tableRules) {
  if (/hover|selected|active|focus|is-/.test(r.sel)) {
    const keep = {};
    for (const k of ['background', 'color', 'box-shadow', 'border-color', 'transition', 'outline', 'outline-offset']) {
      if (r.decls[k]) keep[k] = r.decls[k];
    }
    if (Object.keys(keep).length) {
      console.log(`  ${r.sel.slice(0, 66)}`);
      console.log(`    ${JSON.stringify(keep)}`);
    }
  }
}
