// 删除规则块（支持 @layer / @media 嵌套）
// 关键：进入 { 时的"选择器"是上一个 } 或 ; 或块起始之后的内容，必须正确追踪嵌套层级
import { readFileSync, writeFileSync } from 'node:fs';

const TARGETS = JSON.parse(readFileSync(process.argv[2], 'utf8'));

const norm = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').trim();

/**
 * 扫描文本，找到「选择器 === target」的规则块并删除。
 * 追踪嵌套深度：深度 0 = 顶层（可能是 @layer/@media 内部，也追踪花括号）
 */
function removeBlock(text, target) {
  const wanted = norm(target);
  let i = 0;
  let depth = 0;
  let segStart = 0;   // 当前选择器文本的起点
  let removed = 0;

  while (i < text.length) {
    const ch = text[i];

    if (ch === '{') {
      const selText = norm(text.slice(segStart, i));
      if (selText === wanted) {
        // 找到配对的 }
        let d = 1, j = i + 1;
        while (j < text.length && d > 0) {
          if (text[j] === '{') d++;
          else if (text[j] === '}') d--;
          j++;
        }
        let end = j;
        while (end < text.length && /[\r\n\t ]/.test(text[end])) end++;
        text = text.slice(0, segStart) + text.slice(end);
        removed++;
        i = segStart;
        depth = 0;
        segStart = segStart;
        continue;
      }
      depth++;
      // 进入新块后，选择器起点是 { 之后
      segStart = i + 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      segStart = i + 1;
    } else if (ch === ';' && depth === 0) {
      segStart = i + 1;
    }
    i++;
  }
  return { text, removed };
}

const report = {};
for (const sheet of ['legacy.css', 'v6.css']) {
  const path = `apps/web/src/styles/${sheet}`;
  let text = readFileSync(path, 'utf8');
  const before = text.length;
  const targets = TARGETS.filter((t) => t.sheet === sheet);
  if (!targets.length) continue;

  let removed = 0;
  const failures = [];
  for (const t of targets) {
    const r = removeBlock(text, t.sel);
    if (r.removed) { text = r.text; removed += r.removed; }
    else failures.push(t.sel);
  }
  writeFileSync(path, text, 'utf8');
  report[sheet] = { removed, total: targets.length, failures };
  console.log(`${sheet}: ${removed}/${targets.length} 条  ${(before / 1024).toFixed(1)}KB → ${(text.length / 1024).toFixed(1)}KB`);
  for (const f of failures) console.log(`   未删: ${f.slice(0, 86)}`);
}
writeFileSync('docs/gates/removal-report.json', JSON.stringify(report, null, 2));
