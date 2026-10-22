// 找侧栏 hover 触发的感应区与判定逻辑
import { readFileSync, readdirSync, statSync } from 'node:fs';

const dir = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';

const keys = ['mouseenter', 'pointerenter', 'onMouseEnter', 'hoverZone', 'triggerZone'];

for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const p = `${dir}/${f}`;
  if (statSync(p).size > 14 * 1024 * 1024) continue;
  let js;
  try { js = readFileSync(p, 'utf8'); } catch { continue; }
  // 只在同时提到 sidebar 的文件里找
  if (!js.includes('sidebar') && !js.includes('Sidebar')) continue;
  for (const k of keys) {
    const i = js.indexOf(k);
    if (i < 0) continue;
    console.log(`\n=== ${f} ← ${k} @ ${i} ===`);
    console.log(js.slice(Math.max(0, i - 400), i + 400).replace(/\s+/g, ' '));
    break;
  }
}
