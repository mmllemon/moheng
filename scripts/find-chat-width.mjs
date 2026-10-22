// 找 hana 会话窗口的宽度机制（用户可自定义）
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

// 1. 找所有 max-width / --chat-width / content-width 相关变量
console.log('=== 组件 CSS 里的宽度变量 ===\n');
const widthVars = new Map();
for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const ms = css.match(/--[\w-]*(?:width|measure|column)[\w-]*\s*:\s*[^;}]+/g);
  if (ms) {
    for (const m of ms) {
      const name = m.split(':')[0].trim();
      if (!widthVars.has(name)) widthVars.set(name, new Set());
      widthVars.get(name).add(f);
    }
  }
}
for (const [name, fs] of [...widthVars.entries()].sort()) {
  console.log(`  ${name.padEnd(40)} ${[...fs].slice(0, 2).join(', ')}`);
}

// 2. 找 ChatTranscript 里的内容宽度规则
console.log('\n\n=== ChatTranscript 里的 max-width / width 规则 ===\n');
const ct = readFileSync(`${dir}/ChatTranscript-DhOABhoU.css`, 'utf8');
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
while ((m = ruleRe.exec(ct))) {
  const sel = m[1].trim();
  const body = m[2];
  if (!/max-width|--chat/.test(body)) continue;
  const hits = body.split(';').filter((d) => /max-width|--chat[\w-]*width/.test(d));
  if (!hits.length) continue;
  console.log(`  ${sel.slice(0, 62)}`);
  for (const h of hits) console.log(`      ${h.trim().slice(0, 100)}`);
}
