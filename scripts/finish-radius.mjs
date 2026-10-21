// 收尾：把剩余硬编码圆角换成 token/calc，并补 corner-shape
import { readFileSync, writeFileSync } from 'node:fs';

const F = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
let c = readFileSync(F, 'utf8');

const rules = [
  ['.date-picker-trigger {', 'border-radius: 8px !important;', 'border-radius: var(--radius-md) !important;'],
  ['.date-picker-popover', 'border-radius: 12px !important;', 'border-radius: var(--radius-lg) !important;'],
  ['.date-picker-day.is-selected', 'border-radius: 8px !important;', 'border-radius: var(--radius-md) !important;'],
  ['.account-menu {', 'border-radius: 18px !important;', 'border-radius: calc(10px * var(--corner-radius-scale, 1)) !important;'],
  ['.quick-action-panel {', 'border-radius: 20px;', 'border-radius: calc(11px * var(--corner-radius-scale, 1));'],
  ['.command-palette {', 'border-radius: 18px;', 'border-radius: calc(10px * var(--corner-radius-scale, 1));'],
];

for (const [sel, from, to] of rules) {
  const i = c.indexOf(sel);
  if (i < 0) { console.log('NF ' + sel); continue; }
  const end = c.indexOf('}', i);
  let block = c.slice(i, end);
  if (!block.includes(from)) { console.log('no radius match: ' + sel); continue; }
  block = block.replace(from, to);
  if (!block.includes('corner-shape')) {
    block = block.replace(/\s+$/, '') + '\n  corner-shape: squircle;';
  }
  c = c.slice(0, i) + block + c.slice(end);
  console.log('fixed ' + sel);
}

writeFileSync(F, c, 'utf8');
console.log('corner-shape total=' + (c.match(/corner-shape/g) || []).length);
