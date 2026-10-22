// 在 renderer 全部 33 个 CSS 里搜「侧栏内部分隔线」
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));
console.log(`共 ${files.length} 个 CSS 文件\n`);

// 找含 sidebar / session / search 相关类名的文件
const keywords = ['sidebar', 'session', 'search', 'divider', 'separator'];

for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const hits = keywords.filter((k) => css.toLowerCase().includes(k));
  if (hits.length) {
    console.log(`${f.padEnd(46)} ${hits.join(', ')}`);
  }
}

// 专门找 border-top / border-bottom 在 sidebar 上下文里
console.log('\n=== 含 border-top / border-bottom 的规则（可能有分隔线）===');
for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const re = /([^{}]+)\{([^{}]*border-(top|bottom)\s*:\s*[^;{}]+[^{}]*)\}/g;
  let m;
  const found = [];
  while ((m = re.exec(css))) {
    const sel = m[1].trim().slice(-60);
    const decl = m[2].trim().slice(0, 90);
    found.push(`  ${sel}  →  ${decl}`);
  }
  if (found.length) {
    console.log(`\n[${f}]`);
    for (const x of found.slice(0, 8)) console.log(x);
  }
}
