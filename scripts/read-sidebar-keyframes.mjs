// 读侧栏相关的所有 @keyframes 关键帧
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35';

const files = [];
function walk(p) {
  for (const e of readdirSync(p, { withFileTypes: true })) {
    if (e.isDirectory()) walk(`${p}/${e.name}`);
    else if (e.name.endsWith('.css')) files.push(`${p}/${e.name}`);
  }
}
walk(dir);

const wanted = ['fp', 'sidebar', 'Sidebar', 'chalkboardSlide', 'panel', 'Panel', 'traffic'];

for (const f of files) {
  const css = readFileSync(f, 'utf8');
  const re = /@keyframes\s+([\w-]+)\s*\{/g;
  let m;
  while ((m = re.exec(css))) {
    const name = m[1];
    if (!wanted.some((w) => name.includes(w))) continue;
    // 找匹配的闭合
    let depth = 0;
    let i = m.index + m[0].length - 1;
    const start = i;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) break; }
    }
    const body = css.slice(start + 1, i);
    console.log(`\n=== @keyframes ${name}  [${f.replace(dir + '/', '')}] ===`);
    for (const line of body.split('}')) {
      const s = line.trim();
      if (s) console.log(`  ${s}}`);
    }
  }
}
