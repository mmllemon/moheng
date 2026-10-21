// 给 hana.css 的矩形圆角规则补 corner-shape: squircle
// 规则：
//   - 只处理值里含 var(--radius-*) 或 calc(... * var(--corner-radius-scale)) 的 border-radius
//   - 跳过 border-radius: 50%（圆形元素，Hana 用 round）
//   - 跳过已经有 corner-shape 的规则块
//   - 保留原有缩进与格式
// 用法：node scripts/add-squircle.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const write = process.argv.includes('--write');
const src = readFileSync(FILE, 'utf8');
const lines = src.split(/\r?\n/);

const out = [];
let changed = 0;
let inBlock = false;
let blockHasRadiusToken = false;
let blockHasCornerShape = false;
let pendingInsertAt = -1;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  const trimmed = line.trim();

  // 块开始（忽略 @media / @supports 这类容器块）
  if (trimmed.endsWith('{') && !/^@/.test(trimmed)) {
    inBlock = true;
    blockHasRadiusToken = false;
    blockHasCornerShape = false;
  }

  if (inBlock) {
    const br = trimmed.match(/^border-radius\s*:\s*(.+?);/);
    if (br) {
      const val = br[1];
      const isCircle = /50%/.test(val) || /99px/.test(val);
      const isToken = /var\(--radius-|var\(--corner-radius-scale|calc\([^)]*var\(--radius/.test(val);
      if (isToken && !isCircle) blockHasRadiusToken = true;
    }
    if (/^corner-shape\s*:/.test(trimmed)) blockHasCornerShape = true;

    // 块结束
    if (trimmed === '}') {
      if (blockHasRadiusToken && !blockHasCornerShape) {
        // 找块内最后一个属性行插入
        let insertAt = -1;
        for (let j = i - 1; j >= 0; j--) {
          const t = lines[j].trim();
          if (t === '') continue;
          if (t === '{') break;
          if (t.endsWith(';') || t.endsWith('}')) { insertAt = j; break; }
        }
        if (insertAt >= 0) {
          const indent = (lines[insertAt].match(/^\s*/) || [''])[0];
          lines.splice(insertAt + 1, 0, `${indent}corner-shape: squircle;`);
          changed++;
          i++; // 跳过新插入行
        }
      }
      inBlock = false;
    }
  }
  out.push(line);
}

// 因为 splice 直接改 lines，这里 out 只用于长度校验
if (write) {
  writeFileSync(FILE, lines.join('\n'), 'utf8');
  console.log(`written: ${changed} rules got corner-shape: squircle`);
} else {
  console.log(`dry-run: would add corner-shape to ${changed} rules`);
}
