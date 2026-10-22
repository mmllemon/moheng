// 读 contributed-keybindings 里 fpCollapsed 的真实渲染逻辑
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/contributed-keybindings-BWxnaFR2.js`, 'utf8');

let i = 0;
let n = 0;
while ((i = js.indexOf('fpCollapsed', i)) !== -1 && n < 5) {
  n++;
  console.log(`\n${'='.repeat(84)}\n=== fpCollapsed #${n} @ ${i} ===`);
  console.log(js.slice(Math.max(0, i - 1100), i + 700).replace(/\s+/g, ' '));
  i += 'fpCollapsed'.length;
}
