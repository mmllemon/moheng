// 会话内容列宽机制
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const css = readFileSync(`${dir}/mobile-kfy_1ie4.css`, 'utf8');

const KEYS = ['--chat-column-width', '--chat-copy-column', '--editor-markdown-content-width', '--chat-input-column-width'];

console.log('=== 变量定义与使用 ===\n');
for (const k of KEYS) {
  const defRe = new RegExp(`${k}\\s*:\\s*([^;}]+)`, 'g');
  const defs = [...css.matchAll(defRe)].map((m) => m[1].trim());
  console.log(`${k}`);
  console.log(`  定义: ${[...new Set(defs)].join(' | ') || '(无)'}`);
}

// 找用到这些变量的规则
console.log('\n\n=== 使用这些变量的规则 ===\n');
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
let m;
const seen = new Set();
while ((m = ruleRe.exec(css))) {
  const sel = m[1].trim();
  const body = m[2];
  for (const k of KEYS) {
    if (!body.includes(k)) continue;
    const key = sel + k;
    if (seen.has(key)) continue;
    seen.add(key);
    const hits = body.split(';').filter((d) => d.includes(k) || /max-width|width/.test(d));
    console.log(`  ${sel.slice(0, 58)}`);
    for (const h of hits.slice(0, 4)) console.log(`      ${h.trim().slice(0, 95)}`);
  }
}
