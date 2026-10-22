// 读 CardShell 的 JSX 骨架 —— 会话卡片的真实 DOM 嵌套
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/CardShell-DVSoA_HL.js`, 'utf8');

console.log('文件长度:', js.length);

// 找 className 引用处，看 JSX 嵌套
const idxs = [];
let i = 0;
while ((i = js.indexOf('className', i)) !== -1 && idxs.length < 40) { idxs.push(i); i += 9; }

// 打印含 chat-area / main-content 的片段
for (const key of ['main-content', 'chat-area']) {
  let p = 0;
  let n = 0;
  while ((p = js.indexOf(key, p)) !== -1 && n < 3) {
    n++;
    console.log(`\n${'='.repeat(70)}\n=== ${key} #${n} ===`);
    console.log(js.slice(Math.max(0, p - 900), p + 700).replace(/\s+/g, ' '));
    p += key.length;
  }
}
