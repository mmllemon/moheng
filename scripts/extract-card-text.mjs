// 提取纯卡片规则的完整原文
import { readFileSync } from 'node:fs';

const split = JSON.parse(readFileSync('D:/WorkSpace/hana/moheng/docs/gates/card-split.json', 'utf8'));

for (const sheet of ['legacy.css', 'v6.css']) {
  const lines = readFileSync(`D:/WorkSpace/hana/moheng/apps/web/src/styles/${sheet}`, 'utf8').split('\n');
  const targets = split.pure.filter((t) => t.sheet === sheet);
  if (!targets.length) continue;

  console.log(`\n${'#'.repeat(80)}\n# ${sheet} — ${targets.length} 条\n${'#'.repeat(80)}`);

  for (const t of targets) {
    const want = t.sel.replace(/\s+/g, ' ').trim();
    let found = -1, count = 0;
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('{')) continue;
      const sel = lines[i].slice(0, lines[i].indexOf('{')).replace(/\s+/g, ' ').trim();
      if (sel === want) { count++; if (found < 0) found = i; }
    }
    if (found < 0) { console.log(`\n[未定位] ${want.slice(0, 80)}`); continue; }

    const buf = [];
    let j = found;
    while (j < lines.length && !lines[j].includes('}')) { buf.push(lines[j]); j++; }
    buf.push(lines[j] || '');
    console.log(`\n--- 行${found + 1} 匹配${count}处 hits=${t.hits}`);
    console.log(JSON.stringify(buf.join('\n')));
  }
}
