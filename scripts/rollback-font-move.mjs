import { readFileSync, writeFileSync } from 'node:fs';

// 1) 从 hana.css 移除刚搬进去的字体块（回退该迁移，因为旧层暂不退役）
const hanaPath = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';
let hana = readFileSync(hanaPath, 'utf8');
const marker = '/* =============================================================\n   字体声明（原在 v6.css，旧层退役时迁入）';
const idx = hana.indexOf(marker);
if (idx !== -1) {
  hana = hana.slice(0, idx).replace(/\s+$/, '') + '\n';
  writeFileSync(hanaPath, hana, 'utf8');
  console.log('removed font block from hana.css');
} else {
  console.log('font block marker not found in hana.css');
}

// 2) 确认 v6.css 仍保有字体声明
const v6 = readFileSync('D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css', 'utf8');
console.log('v6 font-face count =', (v6.match(/@font-face/g) || []).length);
console.log('hana font-face count =', (readFileSync(hanaPath, 'utf8').match(/@font-face/g) || []).length);
