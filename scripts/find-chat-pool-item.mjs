// 全仓搜索 parallelChatPoolItem 的样式定义位置
import { readdirSync, readFileSync } from 'node:fs';

const dirs = [
  'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets',
  'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets',
];

for (const d of dirs) {
  let files;
  try { files = readdirSync(d).filter((f) => f.endsWith('.css')); } catch { continue; }
  for (const f of files) {
    const css = readFileSync(`${d}/${f}`, 'utf8');
    for (const key of ['parallelChatPoolItem', 'parallelChatPoolHost']) {
      if (!css.includes(key)) continue;
      console.log(`\n### ${f}  ←  ${key}`);
      const re = new RegExp(`[^{}]*${key}[^{]*\\{[^}]*\\}`, 'g');
      for (const m of css.match(re) ?? []) {
        const i = m.indexOf('{');
        console.log(`  【${m.slice(0, i).trim()}】`);
        for (const d2 of m.slice(i + 1, -1).split(';')) {
          const s = d2.trim();
          if (!s) continue;
          console.log(`      ${s.slice(0, 96)}`);
        }
      }
    }
  }
}
