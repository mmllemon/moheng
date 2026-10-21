// 对比分析：Hana 按钮的层级体系 vs moheng 的按钮
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/WorkSpace/hana/hana-seed/renderer/assets';
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (e.endsWith('.css')) out.push(p);
  }
  return out;
}
function* rules(css) {
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = []; let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim().replace(/\s+/g, ' ');
      const sel = stack.pop() || ''; buf = '';
      if (body && sel && !sel.startsWith('@')) yield { sel, body };
    } else buf += ch;
  }
}
const files = walk(ROOT);

// 收集"按钮主体"规则：有 height/min-height 且选择器指向交互控件
const rows = [];
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  for (const r of rules(css)) {
    const d = {};
    for (const p of r.body.split(';')) {
      const i = p.indexOf(':'); if (i < 0) continue;
      d[p.slice(0, i).trim()] = p.slice(i + 1).trim();
    }
    const h = d.height || d['min-height'];
    if (!h) continue;
    // 只保留看起来是按钮/可点击控件
    if (!/button|btn|_view|_tool|_icon|_close|_next|_back|action|pill|chip|toggle|seg|_item/i.test(r.sel)) continue;
    rows.push({
      file: f.split(/[\\/]/).pop().replace(/\.css$/, ''),
      sel: r.sel.replace(/\s+/g, ' ').slice(0, 92),
      h: h.replace(/var\(--control-height, 32px\)/, '32px'),
      pad: d.padding || '',
      fs: d['font-size'] || '',
      radius: d['border-radius'] || '',
      justify: d['justify-content'] || '',
      display: d.display || '',
      border: d.border || '',
    });
  }
}

// 按高度归组
const byH = new Map();
for (const r of rows) {
  if (!byH.has(r.h)) byH.set(r.h, []);
  byH.get(r.h).push(r);
}
console.log('########## Hana 按钮/交互控件 按高度归组 ##########\n');
const order = [];
for (const [h, list] of byH) order.push([h, list.length, list]);
order.sort((a, b) => b[1] - a[1]);
for (const [h, n, list] of order.slice(0, 14)) {
  console.log(`\n=== ${h}  (${n} 条) ===`);
  const seen = new Set();
  for (const r of list.slice(0, 8)) {
    const key = r.sel.slice(0, 40);
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`  .${r.sel.slice(0, 74)}`);
    const bits = [];
    if (r.pad) bits.push(`pad:${r.pad}`);
    if (r.fs) bits.push(`fs:${r.fs}`);
    if (r.radius) bits.push(`r:${r.radius}`);
    if (r.justify) bits.push(`jc:${r.justify}`);
    if (bits.length) console.log(`      ${bits.join('  ')}`);
  }
}

// 极值：最大最小按钮
console.log('\n########## 尺寸谱系（去重后排序）##########');
const uniq = [...new Set(rows.map((r) => r.h))]
  .map((h) => ({ h, n: rows.filter((r) => r.h === h).length }))
  .sort((a, b) => {
    const ph = (s) => parseFloat(s) || 0;
    return ph(a.h) - ph(b.h);
  });
for (const u of uniq) console.log(`  ${String(u.n).padStart(3)}×  ${u.h}`);
