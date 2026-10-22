// 排查工具为什么把输入控件规则误判为 dead
import { readFileSync } from 'node:fs';

const d = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/full-migration-map.json', 'utf8'));

const targets = [
  '.toolbar-search input',
  '.field input, .field select, .field textarea',
];

for (const t of targets) {
  const norm = (s) => s.replace(/\s+/g, '');
  const hit = [...d.dead, ...d.partial, ...d.alive].find((x) => norm(x.sel) === norm(t));
  if (!hit) { console.log(`未找到: ${t}`); continue; }
  const kind = d.dead.includes(hit) ? 'dead' : d.partial.includes(hit) ? 'partial' : 'alive';
  console.log(`\n[${kind}] ${hit.sel}`);
  console.log(`  hits=${hit.hits}  声明属性数=${hit.declCount}`);
  console.log(`  covered:   ${hit.covered.join(' ')}`);
  console.log(`  uncovered: ${hit.uncovered.join(' ') || '(空)'}`);
}

// 关键疑问：.field input 在 hana.css 里到底有没有 skin？
console.log('\n\n=== hana.css 里 .field input 相关规则 ===');
const hana = readFileSync('D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css', 'utf8');
const lines = hana.split('\n');
let buf = [];
let depth = 0;
let inRule = false;
for (let i = 0; i < lines.length; i++) {
  const l = lines[i];
  if (!inRule && /\.field input|html input:not|\.field select|\.field textarea/.test(l)) {
    inRule = true; buf = []; depth = 0;
  }
  if (inRule) {
    buf.push(l);
    depth += (l.match(/\{/g) || []).length;
    depth -= (l.match(/\}/g) || []).length;
    if (depth === 0 && buf.length > 1) {
      const text = buf.join(' ').replace(/\s+/g, ' ');
      if (/background|border|color/.test(text)) {
        console.log(`  行${i - buf.length + 2}: ${text.slice(0, 200)}`);
      }
      inRule = false; buf = [];
    }
  }
}
