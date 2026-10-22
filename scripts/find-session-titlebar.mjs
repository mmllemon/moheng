// 找 hana 会话标题栏：可能是与 .titlebar 重叠的另一层
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

// 候选关键词：会话/对话/聊天 标题
const KEYS = ['convoTitle', 'chatTitle', 'sessionTitle', 'titlebar'];

for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  for (const key of KEYS) {
    const re = new RegExp(`\\._${key}[a-zA-Z0-9]*_[a-f0-9]{5}[^{]*\\{[^}]*\\}`, 'g');
    const ms = css.match(re);
    if (ms) {
      console.log(`\n[${f}] .${key}*`);
      for (const m of ms.slice(0, 6)) {
        const sel = m.slice(0, m.indexOf('{'));
        const body = m.slice(m.indexOf('{') + 1, -1);
        console.log(`  ${sel}`);
        for (const d of body.split(';').filter((x) => x.trim())) {
          console.log(`      ${d.trim().slice(0, 100)}`);
        }
      }
    }
  }
}

// 另外：找 fixed/absolute + top:0 + height 44-56 的顶栏层
console.log('\n\n=== 可能重叠在顶部的层（fixed/absolute + top:0）===\n');
for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const sel = m[1].trim();
    const body = m[2];
    if (!/position\s*:\s*(fixed|absolute)/.test(body)) continue;
    if (!/top\s*:\s*(0|var\(--titlebar-h\))/.test(body)) continue;
    const h = /height\s*:\s*([^;]+)/.exec(body);
    if (!h) continue;
    const hv = h[1].trim();
    if (!/4[0-9]px|5[0-9]px|var\(--titlebar-h\)/.test(hv)) continue;
    const bg = /background[^:]*:\s*([^;]+)/.exec(body);
    console.log(`  [${f}]`);
    console.log(`    ${sel.slice(0, 60)}`);
    console.log(`      height: ${hv}${bg ? `  background: ${bg[1].slice(0, 50)}` : ''}`);
  }
}
