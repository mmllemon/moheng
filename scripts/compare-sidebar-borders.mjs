// 侧栏内部分隔线对比：hana vs moheng
import { readFileSync } from 'node:fs';

function parseBlocks(path) {
  const css = readFileSync(path, 'utf8');
  const lines = css.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t.includes('{') && !t.startsWith('@') && !t.startsWith('}') && !t.startsWith('/*') && !t.startsWith('//')) {
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
      if (sel) out.push({ sel, body: decls.join(';\n') });
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

const hana = parseBlocks('D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css')
  .filter((b) => /sidebar/i.test(b.sel));

console.log('=== hana 侧栏相关规则中带 border 的 ===\n');
for (const b of hana) {
  const borders = b.body.split('\n').filter((d) => /^\s*border(-top|-bottom|-left|-right)?\s*:/.test(d) && !/:\s*(none|0)/.test(d));
  const gaps = b.body.split('\n').filter((d) => /^\s*(gap|padding)\s*:/.test(d));
  if (borders.length) {
    console.log(`【${b.sel}】`);
    for (const x of borders) console.log(`    ${x.trim()}`);
    for (const g of gaps) console.log(`    ${g.trim()}`);
    console.log('');
  }
}

console.log('\n=== moheng 侧栏相关规则中带 border 的 ===\n');
const moheng = ['hana.css', 'legacy.css', 'v6.css']
  .flatMap((f) => parseBlocks(`D:/WorkSpace/hana/moheng/apps/web/src/styles/${f}`).map((b) => ({ ...b, file: f })))
  .filter((b) => /app-sidebar|sidebar-/i.test(b.sel));

for (const b of moheng) {
  const borders = b.body.split('\n').filter((d) => /^\s*border(-top|-bottom|-left|-right)?\s*:/.test(d) && !/:\s*(none|0)/.test(d));
  if (borders.length) {
    console.log(`【${b.sel}】 (${b.file})`);
    for (const x of borders) console.log(`    ${x.trim()}`);
    console.log('');
  }
}
