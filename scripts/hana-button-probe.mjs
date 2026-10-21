// 拆解 Hana 的按钮体系
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
console.log('total rules:', rules.length);

const BTN_RE = /button|_btn|Btn|_action|Action[^a-z]|_iconButton|iconBtn|_ghost|_primary|_secondary|_danger|_link/i;
const get = (o, ...keys) => {
  for (const k of keys) if (o[k] !== undefined) return o[k];
  return undefined;
};

const btnRules = rules.filter((r) => {
  if (!BTN_RE.test(r.sel)) return false;
  const d = r.decls;
  return get(d, 'height', 'min-height', 'padding', 'padding-inline', 'border-radius');
});
console.log('button-ish rules:', btnRules.length);

const tally = (keyFn) => {
  const o = {};
  for (const r of btnRules) {
    const v = keyFn(r.decls);
    if (v) o[v] = (o[v] || 0) + 1;
  }
  return Object.entries(o).sort((a, b) => b[1] - a[1]);
};

console.log('\n=== 高度 ===');
for (const [v, n] of tally((d) => get(d, 'height', 'min-height')).slice(0, 12)) console.log(`  ${String(v).padEnd(26)} ${n}`);

console.log('\n=== padding ===');
for (const [v, n] of tally((d) => get(d, 'padding', 'padding-inline')).slice(0, 12)) console.log(`  ${String(v).padEnd(36)} ${n}`);

console.log('\n=== 圆角 ===');
for (const [v, n] of tally((d) => get(d, 'border-radius')).slice(0, 10)) console.log(`  ${String(v).padEnd(44)} ${n}`);

console.log('\n=== gap ===');
for (const [v, n] of tally((d) => d.gap).slice(0, 8)) console.log(`  ${String(v).padEnd(20)} ${n}`);

console.log('\n=== 字号 ===');
for (const [v, n] of tally((d) => get(d, 'font-size')).slice(0, 8)) console.log(`  ${String(v).padEnd(20)} ${n}`);

console.log('\n=== 字重 ===');
for (const [v, n] of tally((d) => get(d, 'font-weight')).slice(0, 8)) console.log(`  ${String(v).padEnd(20)} ${n}`);

console.log('\n=== 典型按钮定义 ===');
const samples = btnRules
  .filter((r) => get(r.decls, 'height', 'min-height') && r.decls.display && /flex/.test(r.decls.display))
  .slice(0, 14);
for (const s of samples) {
  const keep = {};
  for (const k of ['display', 'align-items', 'justify-content', 'gap', 'height', 'min-height', 'padding', 'padding-inline', 'border-radius', 'font-size', 'font-weight', 'border', 'background', 'color', 'corner-shape']) {
    if (s.decls[k]) keep[k] = s.decls[k];
  }
  console.log(`\n  ${s.sel.slice(0, 72)}`);
  console.log('   ' + JSON.stringify(keep));
}
