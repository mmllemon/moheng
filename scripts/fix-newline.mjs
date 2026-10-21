import { readFileSync, writeFileSync } from 'node:fs';

const f = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
let c = readFileSync(f, 'utf8');

const BAD = '==== */`n`n@font-face';
const GOOD = '==== */\n\n@font-face';
if (c.includes(BAD)) {
  c = c.replace(BAD, GOOD);
  writeFileSync(f, c, 'utf8');
  console.log('fixed literal backtick-n');
} else {
  console.log('pattern not found; checking variants');
  console.log('has */`n`n :', c.includes('*/`n`n'));
}
console.log('font-face count =', (c.match(/@font-face/g) || []).length);
