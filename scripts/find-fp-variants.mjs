// 找 fpOverlay 的 framer-motion variants 定义（ic）
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/contributed-keybindings-BWxnaFR2.js`, 'utf8');

// 找 ic 的定义
for (const pat of ['const ic=', 'ic={', 'ic =']) {
  const i = js.indexOf(pat);
  if (i < 0) continue;
  console.log(`\n=== ${pat} @ ${i} ===`);
  console.log(js.slice(i, i + 1400).replace(/\s+/g, ' '));
  break;
}

// 也找 variants 里的 hidden/visible/exit
const m = js.match(/ic\s*=\s*\{[\s\S]{0,900}?\}\s*[,;]/);
if (m) {
  console.log('\n=== ic 完整定义 ===');
  console.log(m[0].replace(/\s+/g, ' '));
}
