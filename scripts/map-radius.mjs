// 把 hana.css 里硬编码 px 圆角映射到 Hana 语义 token，并补 corner-shape: squircle
// 映射依据：墨衡的 px 值 ≈ Hana token 基数 × 1.8409 的取整（见 docs/设计系统-hana.md）
// 用法：node scripts/map-radius.mjs [--write]
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
const write = process.argv.includes('--write');

// px -> token 映射表（值已是 scale 后的视觉尺寸，故换成对应 token 即自带 scale）
const MAP = {
  '3px': 'var(--radius-xs)',
  '4px': 'var(--radius-compact)',
  '5px': 'var(--radius-sm)',
  '6px': 'var(--radius-input)',
  '7px': 'var(--radius-action)',
  '8px': 'var(--radius-md)',
  '9px': 'var(--radius-action)',
  '10px': 'var(--radius-control)',
  '11px': 'var(--radius-control)',
  '12px': 'var(--radius-lg)',
  '14px': 'var(--radius-card)',
  '16px': 'var(--radius-card)',
};

const SKIP = /^(0|50%|99px|inherit|unset|auto|none)$/;

const lines = readFileSync(FILE, 'utf8').split(/\r?\n/);

let mapped = 0;
let shaped = 0;
let skippedMulti = [];
let inBlock = false;
let blockHasCornerShape = false;
let blockRadiusIdx = -1;
let blockSel = '';

for (let i = 0; i < lines.length; i++) {
  const trimmed = lines[i].trim();

  if (trimmed.endsWith('{') && !/^@/.test(trimmed)) {
    inBlock = true;
    blockHasCornerShape = false;
    blockRadiusIdx = -1;
    blockSel = trimmed.slice(0, -1).trim();
  }

  if (inBlock) {
    if (/^corner-shape\s*:/.test(trimmed)) blockHasCornerShape = true;

    const br = trimmed.match(/^(border-radius)\s*:\s*(.+?)(\s*!important)?;$/);
    if (br) {
      const val = br[2].trim();
      const important = br[3] || '';
      const indent = lines[i].match(/^\s*/)[0];

      if (SKIP.test(val)) {
        // 圆形元素：Hana 用 round，跳过
      } else if (/^[\d.]+px$/.test(val)) {
        const token = MAP[val];
        if (token) {
          lines[i] = `${indent}border-radius: ${token}${important};`;
          mapped++;
          blockRadiusIdx = i;
        }
      } else if (/^[\d.]+px\s+[\d.]+px/.test(val) || val.split(/\s+/).length > 1) {
        skippedMulti.push(`${blockSel} -> ${val}`);
        if (/var\(--radius-|calc\(/.test(val)) blockRadiusIdx = i;
      } else if (/var\(--radius-|calc\(/.test(val)) {
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
  console.log(`written: mapped=${mapped} shaped=${shaped}`);
} else {
  console.log(`dry-run: map ${mapped} px radii, add ${shaped} corner-shape, skip ${skippedMulti.length} multi-value`);
  if (skippedMulti.length) {
    console.log('\n--- multi-value (need manual review) ---');
    skippedMulti.slice(0, 30).forEach(s => console.log('  ' + s));
  }
}
