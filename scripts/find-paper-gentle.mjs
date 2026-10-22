// 找 paperGentle 缓动定义
import { readFileSync, readdirSync, statSync } from 'node:fs';

const dir = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';

for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const p = `${dir}/${f}`;
  if (statSync(p).size > 14 * 1024 * 1024) continue;
  let js;
  try { js = readFileSync(p, 'utf8'); } catch { continue; }
  const i = js.indexOf('paperGentle');
  if (i < 0) continue;
  console.log(`\n=== ${f} @ ${i} ===`);
  console.log(js.slice(Math.max(0, i - 600), i + 500).replace(/\s+/g, ' '));
  break;
}
