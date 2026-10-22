// 从 legacy/v6 中精确删除指定的规则块（按选择器精确匹配，不从行号定位）
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';

const TARGETS = JSON.parse(readFileSync(process.argv[2], 'utf8'));

function removeBlock(text, selector) {
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const target = norm(selector);
  // 逐字符扫描，找到 { 位置，回溯到规则起始
  let depth = 0;
  let start = 0;
  let i = 0;
  let removed = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) {
        // 规则选择器 = 从 start 到 i
        let selStart = start;
        // 跳过前面的注释/空白
        const sel = norm(text.slice(selStart, i));
        if (sel === target) {
          // 找到匹配的 }
          let d = 1, j = i + 1;
          while (j < text.length && d > 0) {
            if (text[j] === '{') d++;
            else if (text[j] === '}') d--;
            j++;
          }
          // 连同行尾换行一起删
          let end = j;
          while (end < text.length && (text[end] === '\n' || text[end] === '\r' || text[end] === ' ')) end++;
          text = text.slice(0, selStart) + text.slice(end);
          removed++;
          i = selStart;
          depth = 0;
          start = selStart;
          continue;
        }
      }
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      else {
        // 顶层结束（@media / @layer 内层），重置
        start = i + 1;
      }
    } else if (ch === ';' && depth === 0) {
      // @import / @charset 之类
      start = i + 1;
    } else if (ch === '\n' && depth === 0) {
      start = i + 1;
    }
    i++;
  }
  return { text, removed };
}

const stats = {};
for (const sheet of ['legacy.css', 'v6.css']) {
  const path = `apps/web/src/styles/${sheet}`;
  let text = readFileSync(path, 'utf8');
  const before = text.length;
  const targets = TARGETS.filter((t) => t.sheet === sheet);
  if (!targets.length) continue;

  let totalRemoved = 0;
  const failures = [];
  for (const t of targets) {
    const r = removeBlock(text, t.sel);
    if (r.removed) {
      text = r.text;
      totalRemoved += r.removed;
    } else {
      failures.push(t.sel);
    }
  }
  writeFileSync(path, text, 'utf8');
  stats[sheet] = { removed: totalRemoved, before, after: text.length, failures };
  console.log(`${sheet}: 删除 ${totalRemoved}/${targets.length} 条，${(before / 1024).toFixed(1)}KB → ${(text.length / 1024).toFixed(1)}KB`);
  if (failures.length) {
    console.log(`  未找到 ${failures.length} 条:`);
    for (const f of failures) console.log(`    ${f.slice(0, 90)}`);
  }
}
writeFileSync('docs/gates/toolbar-removal-stats.json', JSON.stringify(stats, null, 2));
