// 把 hana.css 里硬编码 px 圆角包成 calc(Npx * var(--corner-radius-scale, 1)) 并补 corner-shape: squircle
// 规则：
//   - 只处理纯单值 px（如 9px），跳过 0 / 50% / 99px / inherit / 变量
//   - 跳过多值（如 0 0 8px 8px）——这些需人工判断
//   - 跳过已经含 corner-radius-scale 的
//   - 跳过已有 corner-shape 的规则块
// 用法：node scripts/scale-radius.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const write = process.argv.includes('--write');
const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

const SKIP = /^(0|50%|99px|inherit|unset|auto|none)$/;

let scaled = 0;
let shaped = 0;
let inBlock = false;
let blockHasCornerShape = false;
let blockRadiusIdx = -1;

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();

  if (trimmed.endsWith('{') && !/^@/.test(trimmed)) {
    inBlock = true;
    blockHasCornerShape = false;
    blockRadiusIdx = -1;
  }

  if (inBlock) {
    if (/^corner-shape\s*:/.test(trimmed)) blockHasCornerShape = true;

    const br = trimmed.match(/^(border-radius)\s*:\s*(.+?);$/);
    if (br) {
      const val = br[2].trim();
      const indent = lines[i].match(/^\s*/)[0];
      if (!SKIP.test(val) && !/var\(|calc\(|%/.test(val) && /^\d+(\.\d+)?px$/.test(val)) {
        lines[i] = `${indent}border-radius: calc(${val} * var(--corner-radius-scale, 1));`;
        scaled++;
        blockRadiusIdx = i;
      } else if (/var\(--radius-|calc\(/.test(val) && !/corner-radius-scale/.test(val)) {
        blockRadiusIdx = i;
      }
    }

    if (trimmed === '}') {
      if (blockRadiusIdx >= 0 && !blockHasCornerShape) {
        const indent = lines[blockRadiusIdx].match(/^\s*/)[0];
        lines.splice(blockRadiusIdx + 1, 0, `${indent}corner-shape: squircle;`);
        shaped++;
        i++;
      }
      inBlock = false;
    }
  }
}

if (write) {
  writeFileSync(FILE, lines.join('\n'), 'utf8');
  console.log(`written: scaled=${scaled} shaped=${shaped}`);
} else {
  console.log(`dry-run: would scale ${scaled} px radii, add ${shaped} corner-shape`);
}
