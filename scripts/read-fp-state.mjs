// 读 hana 侧栏的 JS 状态机：hover 触发、collapsed、overlay 切换
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/ChatTranscript-BhjBc-kF.js`, 'utf8');

// 找 fpCollapsed / fpOverlay 的使用上下文
for (const key of ['fpCollapsed', 'fpOverlay', 'fpShadowless']) {
  let i = 0;
  let n = 0;
  while ((i = js.indexOf(key, i)) !== -1 && n < 3) {
    n++;
    console.log(`\n${'='.repeat(80)}\n=== ${key} #${n} ===`);
    console.log(js.slice(Math.max(0, i - 900), i + 500).replace(/\s+/g, ' '));
    i += key.length;
  }
}
