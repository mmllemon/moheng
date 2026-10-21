// 退役 hana.css 中的确认死类规则块
// 安全策略：
//   - 只删「选择器里所有类都是死类」的规则；若一条规则同时含活类，跳过并记录
//   - 保留注释、@media/@supports 容器（只删其内部死规则）
//   - 输出报告到 docs/gates/retire-hana-report.json
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const DEAD_LIST = 'D:/WorkSpace/hana/moheng/docs/gates/dead-v2-styles_hana.txt';
const REPORT = 'D:/WorkSpace/hana/moheng/docs/gates/retire-hana-report.json';

// 保守排除：这 6 个有子串命中，不删
const KEEP = new Set(['appearance-theme', 'dialog-body', 'dialog-title', 'search-input', 'select-options', 'topbar']);

const dead = readFileSync(DEAD_LIST, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean).filter((c) => !KEEP.has(c));
const deadSet = new Set(dead);

const src = readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

const removed = [];
const skipped = [];
const out = [];

let i = 0;
while (i < lines.length) {
  const line = lines[i];
  const trimmed = line.trim();

  // 规则开始（选择器行以 { 结尾，且不是 @ 容器）
  if (trimmed.endsWith('{') && !trimmed.startsWith('@') && !trimmed.startsWith('/*')) {
    const selector = trimmed.slice(0, -1).trim();
    // 提取选择器里的所有类
    const classes = [...selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]);
    const allDead = classes.length > 0 && classes.every((c) => deadSet.has(c));

    if (allDead) {
      // 找到配对的花括号，整块跳过
      let depth = 1;
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') depth--;
        }
        j++;
      }
      removed.push({ selector, lines: j - i });
      i = j;
      continue;
    } else if (classes.some((c) => deadSet.has(c))) {
      skipped.push({ selector, reason: 'mixed-live-and-dead' });
    }
  }
  out.push(line);
  i++;
}

writeFileSync(FILE, out.join('\n'), 'utf8');
writeFileSync(REPORT, JSON.stringify({ removedCount: removed.length, removedLines: removed.reduce((a, r) => a + r.lines, 0), removed, skipped: skipped.slice(0, 40), skippedCount: skipped.length }, null, 2), 'utf8');

console.log(`removed ${removed.length} rules (${removed.reduce((a, r) => a + r.lines, 0)} lines), skipped ${skipped.length} mixed`);
