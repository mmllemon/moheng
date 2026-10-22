// 找 JS 里侧栏 hover 触发 / collapsed 切换的真实逻辑
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/ChatTranscript-BhjBc-kF.js`, 'utf8');

// 找 fpCollapsed 作为 className 使用的地方（不是映射表）
const patterns = [
  /fpCollapsed\]/g,
  /\.fpCollapsed\b/g,
  /hge\.fpCollapsed/g,
  /\bfp:\s*[A-Za-z$]/g,
];

for (const re of patterns) {
  const ms = [...js.matchAll(re)].slice(0, 4);
  for (const m of ms) {
    const i = m.index;
    console.log(`\n${'='.repeat(80)}\n=== ${re} @ ${i} ===`);
    console.log(js.slice(Math.max(0, i - 700), i + 400).replace(/\s+/g, ' '));
  }
}
