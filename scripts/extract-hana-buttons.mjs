// 从 Hana 全部 CSS 中抽取按钮相关规则，按类名前缀归并，统计几何规格
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

const files = walk(ROOT);
console.log(`扫描 ${files.length} 个 CSS 文件\n`);

// 提取所有规则（含 @media 内）
function* rules(css) {
  // 去注释
  let s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  // 粗略按 } 切块，记录 at-rule 上下文
  const stack = [];
  let depth = 0, buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') {
      depth++;
      const sel = buf.trim();
      stack.push(sel);
      buf = '';
    } else if (ch === '}') {
      depth--;
      const body = buf.trim();
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) yield { sel, body, at: stack.filter((x) => x.startsWith('@')).join(' ') };
      if (!sel) buf = '';
    } else {
      buf += ch;
    }
  }
}

// 按钮选择器：class 或元素里含 button / btn / action / icon-btn
const isButtonSel = (sel) => {
  const low = sel.toLowerCase();
  if (/\.(hs-)?(icon-)?btn|button|\.btn|\.action|\.chip|\.pill|\.toggle|\.seg/.test(low)) return true;
  if (/\bbutton\b/.test(low)) return true;
  return false;
};

const found = [];
for (const f of files) {
  const css = readFileSync(f, 'utf8');
  for (const r of rules(css)) {
    if (!isButtonSel(r.sel)) continue;
    const decls = {};
    for (const part of r.body.split(';')) {
      const i = part.indexOf(':');
      if (i < 0) continue;
      const k = part.slice(0, i).trim();
      const v = part.slice(i + 1).trim();
      if (k && v) decls[k] = v;
    }
    found.push({ file: f.split(/[\\/]/).pop(), sel: r.sel.replace(/\s+/g, ' '), at: r.at, decls });
  }
}

console.log(`按钮相关规则 ${found.length} 条\n`);

// 1) 高度规格统计
const hMap = new Map();
for (const r of found) {
  const h = r.decls.height || r.decls['min-height'];
  if (!h) continue;
  hMap.set(h, (hMap.get(h) || 0) + 1);
}
console.log('=== 高度取值 ===');
for (const [h, n] of [...hMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24)) {
  console.log(`  ${String(n).padStart(3)}×  ${h}`);
}

// 2) padding 规格
const pMap = new Map();
for (const r of found) {
  if (!r.decls.padding) continue;
  pMap.set(r.decls.padding, (pMap.get(r.decls.padding) || 0) + 1);
}
console.log('\n=== padding ===');
for (const [p, n] of [...pMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(`  ${String(n).padStart(3)}×  ${p}`);
}

// 3) 圆角
const rMap = new Map();
for (const r of found) {
  const v = r.decls['border-radius'];
  if (!v) continue;
  rMap.set(v, (rMap.get(v) || 0) + 1);
}
console.log('\n=== border-radius ===');
for (const [v, n] of [...rMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 16)) {
  console.log(`  ${String(n).padStart(3)}×  ${v}`);
}

// 4) 字号 / 字重
const fMap = new Map();
for (const r of found) {
  if (!r.decls['font-size']) continue;
  fMap.set(r.decls['font-size'], (fMap.get(r.decls['font-size']) || 0) + 1);
}
console.log('\n=== font-size ===');
for (const [v, n] of [...fMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${String(n).padStart(3)}×  ${v}`);
}

// 5) 类名谱系：取出所有含 button/btn 的类名
const clsMap = new Map();
for (const r of found) {
  for (const m of r.sel.matchAll(/\.([\w-]*(?:button|btn|action|chip|pill|toggle|seg)[\w-]*)/gi)) {
    clsMap.set(m[1], (clsMap.get(m[1]) || 0) + 1);
  }
}
console.log(`\n=== 按钮类名谱系（${clsMap.size} 个）===`);
for (const [c, n] of [...clsMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${String(n).padStart(3)}×  .${c}`);
}
