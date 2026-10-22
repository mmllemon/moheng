// 精确提取待删规则的完整原文，用于 edit 手工替换
import { readFileSync } from 'node:fs';

const pure = JSON.parse(readFileSync('docs/gates/toolbar-pure.json', 'utf8'));

for (const sheet of ['legacy.css', 'v6.css']) {
  const text = readFileSync(`apps/web/src/styles/${sheet}`, 'utf8');
  const lines = text.split('\n');
  const targets = pure.filter((t) => t.sheet === sheet);
  if (!targets.length) continue;

  console.log(`\n${'#'.repeat(78)}\n# ${sheet}\n${'#'.repeat(78)}`);
  for (const t of targets) {
    const want = t.sel.replace(/\s+/g, ' ').trim();
    let hits = 0, foundLine = -1;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('{')) continue;
      const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').trim();
      if (sel === want) { hits++; if (foundLine < 0) foundLine = i; }
    }
    if (foundLine < 0) { console.log(`\n[未找到] ${want}`); continue; }
    // 组装完整块
    let j = foundLine, buf = [];
    while (j < lines.length && !lines[j].includes('}')) { buf.push(lines[j]); j++; }
    buf.push(lines[j] || '');
    console.log(`\n--- 行 ${foundLine + 1}  匹配${hits}处  ${want.slice(0, 60)}`);
    console.log(JSON.stringify(buf.join('\n')));
  }
}
