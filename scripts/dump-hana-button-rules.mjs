// 打印 Hana 按钮设计系统的核心规则全文
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
  const stack = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim().replace(/\s+/g, ' ');
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) yield { sel, body, at: stack.filter((x) => x.startsWith('@')).join(' ') };
    } else buf += ch;
  }
}

const files = walk(ROOT);

// --- 1) .hs-button 系列全文 ---
console.log('########## .hs-button 设计系统按钮 ##########\n');
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  const hits = [];
  for (const r of rules(css)) {
    if (/\.hs-btn|\.hs-button/.test(r.sel)) hits.push(r);
  }
  if (!hits.length) continue;
  console.log(`--- ${f.split(/[\\/]/).pop()} ---`);
  for (const r of hits) console.log(`${r.at ? `[${r.at}] ` : ''}${r.sel.replace(/\s+/g, ' ')}\n{ ${r.body} }\n`);
}

// --- 2) 高度/尺寸相关 token ---
console.log('\n########## 按钮尺寸 token 定义 ##########\n');
const TOKENS = ['--control-height', '--input-control-size', '--corner-radius-scale', '--radius-sm', '--radius-input', '--radius-md', '--radius-xs', '--fs-ui', '--fs-caption', '--fs-hint', '--space-4', '--space-6', '--space-8', '--space-10', '--space-12', '--space-14', '--space-16'];
const tokMap = new Map();
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  for (const r of rules(css)) {
    if (!r.sel.startsWith(':root') && !r.sel.startsWith('html') && !r.sel.includes('[data-theme')) continue;
    for (const t of TOKENS) {
      const re = new RegExp(`${t}\\s*:\\s*([^;]+)`, 'g');
      let m;
      while ((m = re.exec(r.body))) {
        const k = `${t} = ${m[1].trim()}`;
        if (!tokMap.has(k)) tokMap.set(k, new Set());
        tokMap.get(k).add(f.split(/[\\/]/).pop());
      }
    }
  }
}
for (const [k] of [...tokMap.entries()].sort()) console.log('  ' + k);
