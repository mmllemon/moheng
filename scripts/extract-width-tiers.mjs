// 提取 hana 的宽度档位定义
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/SettingsModalShell-DlzVJAiv.js`, 'utf8');

// 找宽度档位数组：形如 [{value:600,width:600},...] 或含 "unlimited"
const patterns = [
  /\{[^{}]*value:\s*\d+[^{}]*width:\s*\d+[^{}]*\}/g,
  /\{[^{}]*width:\s*"unlimited"[^{}]*\}/g,
];

console.log('=== 宽度档位（含 value/width）===\n');
const seen = new Set();
for (const re of patterns) {
  for (const m of js.matchAll(re)) {
    const s = m[0].replace(/\s+/g, ' ');
    if (seen.has(s)) continue;
    seen.add(s);
    console.log(`  ${s.slice(0, 140)}`);
  }
}

// 找 labelKey 附近的档位
console.log('\n\n=== 含 readingWidth 的上下文 ===\n');
const idx = js.indexOf('readingWidthUnlimited');
if (idx > 0) {
  console.log(js.slice(Math.max(0, idx - 700), idx + 200).replace(/\s+/g, ' '));
}

// 找 chatWidth 选项变量
console.log('\n\n=== chatWidth 选项 ===\n');
const ci = js.indexOf('appearance.chatWidth');
if (ci > 0) {
  console.log(js.slice(Math.max(0, ci - 500), ci + 300).replace(/\s+/g, ' '));
}
