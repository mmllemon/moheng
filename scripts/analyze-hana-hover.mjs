// Hana 按钮 hover/focus/active 状态完整规则
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'D:/WorkSpace/hana/hana-seed/renderer/assets';

function parse(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim();
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) out.push({ sel: sel.replace(/\s+/g, ' '), body });
    } else buf += ch;
  }
  return out;
}

// 1) .hs-button 官方设计系统按钮的全部状态
console.log('########## .hs-button 官方按钮状态全表 ##########\n');
const cardCss = readFileSync(join(ROOT, 'card-style', 'hana-card-style.css'), 'utf8');
for (const r of parse(cardCss)) {
  if (!/\.hs-button/.test(r.sel)) continue;
  const decls = r.body.split(';').map((s) => s.trim()).filter(Boolean);
  const keep = decls.filter((d) => /background|border|color|opacity|transform|box-shadow|transition|cursor|filter/.test(d));
  if (!keep.length) continue;
  console.log(`${r.sel}`);
  for (const k of keep) console.log(`    ${k}`);
  console.log('');
}

// 2) 全站 hover 状态里，背景/边框/文字三者的联动比例
console.log('\n########## 全站按钮 hover 的状态维度统计 ##########\n');
const files = readdirSync(ROOT).filter((f) => f.endsWith('.css'));
let total = 0;
const dims = { bg: 0, border: 0, color: 0, shadow: 0, transform: 0, opacity: 0 };
const samples = [];

for (const f of files) {
  const css = readFileSync(join(ROOT, f), 'utf8');
  for (const r of parse(css)) {
    if (!/:hover/.test(r.sel)) continue;
    if (!/button|btn|action|icon|tab/i.test(r.sel)) continue;
    total++;
    const has = {
      bg: /background(-color)?\s*:/.test(r.body),
      border: /border(-color)?\s*:/.test(r.body),
      color: /(^|;|\s)color\s*:/.test(r.body),
      shadow: /box-shadow\s*:/.test(r.body),
      transform: /transform\s*:/.test(r.body),
      opacity: /opacity\s*:/.test(r.body),
    };
    for (const k of Object.keys(dims)) if (has[k]) dims[k]++;
    if (samples.length < 6 && has.bg && has.color && has.border) {
      samples.push({ file: f, sel: r.sel.slice(0, 80), body: r.body.slice(0, 200) });
    }
  }
}

console.log(`统计 ${total} 条按钮 hover 规则\n`);
for (const [k, v] of Object.entries(dims)) {
  const pct = ((v / total) * 100).toFixed(0);
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(4)} 条  ${pct}%`);
}

console.log('\n### 背景+边框+文字三者兼有的例子\n');
for (const s of samples) {
  console.log(`[${s.file}]`);
  console.log(`  ${s.sel}`);
  console.log(`  ${s.body}\n`);
}
