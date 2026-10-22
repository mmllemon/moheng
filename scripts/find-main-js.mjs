// 全仓 JS 搜索主界面骨架关键词
import { readdirSync, readFileSync, statSync } from 'node:fs';

const dir = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const keys = ['chat-area', 'main-content', 'parallelChatSurface', 'chatTitleBar'];

for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const p = `${dir}/${f}`;
  if (statSync(p).size > 12 * 1024 * 1024) continue;
  let js;
  try { js = readFileSync(p, 'utf8'); } catch { continue; }
  const hits = keys.filter((k) => js.includes(k));
  if (hits.length) console.log(`${f.padEnd(46)} ${hits.join(', ')}`);
}
