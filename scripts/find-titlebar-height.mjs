// 找 windowTitlebarFrame 的完整定义与高度默认值
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/contributed-keybindings-BWxnaFR2.js`, 'utf8');

const i = js.indexOf('windowTitlebarFrame');
if (i > 0) {
  console.log('=== windowTitlebarFrame 上下文 ===');
  console.log(js.slice(Math.max(0, i - 1000), i + 1600).replace(/\s+/g, ' '));
}

// 找 titlebar 高度常量
console.log('\n\n=== 可能的标题栏高度常量 ===');
const nums = js.match(/\b(?:titlebarHeight|titlebar-h|TITLEBAR[A-Z_]*)\s*[=:]\s*\d+/g);
if (nums) for (const n of nums) console.log(`  ${n}`);

// 找 44 / 48 / 52 附近的赋值
const ctx = js.match(/.{40}(?:height\s*:\s*(?:44|48|52)).{40}/g);
if (ctx) for (const c of ctx.slice(0, 6)) console.log(`  ${c.replace(/\s+/g, ' ')}`);
