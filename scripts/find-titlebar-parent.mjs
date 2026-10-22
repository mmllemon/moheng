// 找 chatTitleBar 在 JS 里的父容器与兄弟结构
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/ChatTranscript-BhjBc-kF.js`, 'utf8');

const KEY = 'chatTitleBar';
let idx = 0;
let n = 0;
while ((idx = js.indexOf(KEY, idx)) !== -1 && n < 4) {
  n++;
  const start = Math.max(0, idx - 600);
  const end = Math.min(js.length, idx + 500);
  const ctx = js.slice(start, end).replace(/\s+/g, ' ');
  console.log(`\n=== 出现 ${n} ===`);
  console.log(ctx);
  idx += KEY.length;
}
