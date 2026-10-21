import { readFileSync, writeFileSync } from 'node:fs';

const v6Path = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css';
const hanaPath = 'D:/WorkSpace/hana/moheng/apps/web/src/styles/hana.css';

const v6 = readFileSync(v6Path, 'utf8');
const faces = [...v6.matchAll(/@font-face\{[^}]*\}/g)].map((m) => m[0]);
console.log('found font-face in v6:', faces.length);

let hana = readFileSync(hanaPath, 'utf8');
if (hana.includes('MH Serif SC') && hana.includes('@font-face')) {
  console.log('hana.css already has font-face, skipping');
} else {
  const block = [
    '',
    '/* =============================================================',
    '   字体声明',
    '   -------------------------------------------------------------',
    '   原在 v6.css；旧层退役时迁入 hana.css，避免禁用旧层后字体丢失。',
    '   MH Serif SC 是可变字体（Noto Serif SC Variable）：wght 轴 200-900，',
    '   八个命名实例。旧声明 400 800 与轴不匹配且默认实例是最细的 200，',
    '   导致标题回退到 ExtraLight——这是标题"轻飘"的真正根因。',
    '   ============================================================= */',
    '',
    ...faces,
    '',
  ].join('\n');
  hana = hana.replace(/\s+$/, '') + '\n' + block;
  writeFileSync(hanaPath, hana, 'utf8');
  console.log('appended to hana.css');
}

const check = readFileSync(hanaPath, 'utf8');
console.log('hana font-face count =', (check.match(/@font-face/g) || []).length);
console.log('braces balanced =', (check.match(/\{/g) || []).length === (check.match(/\}/g) || []).length);
