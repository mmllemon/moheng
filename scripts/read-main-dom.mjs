// 从 JS 里挖出主界面 DOM 骨架：root > sidebar + main-content 的实际嵌套
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/contributed-keybindings-BWxnaFR2.js`, 'utf8');

// 找 main-content 的 JSX 上下文
for (const key of ['"main-content"', 'mainContent', 'chat-area']) {
  const i = js.indexOf(key);
  if (i < 0) { console.log(`\n=== ${key} 未找到 ===`); continue; }
  console.log(`\n${'='.repeat(72)}\n=== ${key} @ ${i} ===`);
  console.log(js.slice(Math.max(0, i - 700), i + 900).replace(/\s+/g, ' '));
}
