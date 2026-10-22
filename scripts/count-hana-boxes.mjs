// hana 的「盒子感」：从 CSS 统计有多少组件带边框/背景/阴影
import { readFileSync } from 'node:fs';

const css = readFileSync('D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css', 'utf8');

// 解析规则块
const blocks = [];
{
  const lines = css.split('\n');
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.includes('{') && !t.startsWith('@') && !t.startsWith('}') && !t.startsWith('/*')) {
      const sel = t.slice(0, t.indexOf('{')).trim();
      let depth = (t.match(/\{/g) || []).length - (t.match(/\}/g) || []).length;
      const decls = [];
      const inline = t.slice(t.indexOf('{') + 1, t.lastIndexOf('}'));
      if (inline && inline.includes(':')) decls.push(inline);
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        const l = lines[j].trim();
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        if (l.includes(':')) decls.push(l.replace(/\}.*$/, ''));
        if (depth <= 0) break;
        j++;
      }
      if (sel) blocks.push({ sel, body: decls.join(';') });
      i = j + 1;
      continue;
    }
    i++;
  }
}

const withBorder = blocks.filter((b) => /border(-top|-bottom|-left|-right)?:\s*1px solid/.test(b.body));
const withBg = blocks.filter((b) => /background(-color)?:\s*(var\(--(bg|paper|surface|card)|#(f|e)[0-9a-f]{5}|rgb)/i.test(b.body));
const withShadow = blocks.filter((b) => /box-shadow:\s*(?!none)/.test(b.body));
const withRadius = blocks.filter((b) => /border-radius:/.test(b.body));

console.log(`hana 规则总数: ${blocks.length}\n`);
console.log(`带 1px solid 边框: ${withBorder.length} 条`);
console.log(`带不透明背景:     ${withBg.length} 条`);
console.log(`带阴影:           ${withShadow.length} 条`);
console.log(`带圆角:           ${withRadius.length} 条`);

console.log('\n=== 带边框的规则（前 25）===');
for (const b of withBorder.slice(0, 25)) {
  const bg = /background(-color)?:\s*([^;]+)/.exec(b.body);
  console.log(`  ${b.sel.slice(0, 52).padEnd(54)} ${bg ? bg[2].slice(0, 22) : '无背景'}`);
}

// 圆角分布
const radii = new Map();
for (const b of withRadius) {
  const m = /border-radius:\s*([^;]+)/.exec(b.body);
  if (!m) continue;
  const v = m[1].trim().slice(0, 30);
  radii.set(v, (radii.get(v) || 0) + 1);
}
console.log('\n=== 圆角值分布（前 10）===');
for (const [v, n] of [...radii.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`  ${v.padEnd(42)} ${n} 条`);
}
