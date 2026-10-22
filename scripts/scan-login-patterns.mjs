// 扫描所有浏览器脚本的登录代码，看有几种写法
import { readFileSync } from 'node:fs';
import { readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/scripts';
const files = readdirSync(dir).filter((f) => f.endsWith('.mjs'));

const patterns = new Map();

for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  if (!text.includes('chromium.launch')) continue;
  if (text.includes("from './_harness.mjs'")) continue;

  // 找出登录相关代码块
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /input\[type=email\]/.test(l));
  if (idx < 0) continue;

  // 往上找 2 行，往下找 6 行
  const start = Math.max(0, idx - 3);
  const end = Math.min(lines.length, idx + 7);
  const block = lines.slice(start, end).map((l) => l.trim()).filter(Boolean).join('\n');

  if (!patterns.has(block)) patterns.set(block, []);
  patterns.get(block).push(f);
}

console.log(`共 ${patterns.size} 种登录写法\n`);
let i = 0;
for (const [block, fs] of [...patterns.entries()].sort((a, b) => b[1].length - a[1].length)) {
  i++;
  console.log(`=== 写法 ${i}（${fs.length} 个脚本）===`);
  console.log(block.slice(0, 500));
  console.log(`用于: ${fs.slice(0, 6).join(', ')}${fs.length > 6 ? ` +${fs.length - 6}` : ''}`);
  console.log();
  if (i >= 5) { console.log(`...还有 ${patterns.size - i} 种`); break; }
}
