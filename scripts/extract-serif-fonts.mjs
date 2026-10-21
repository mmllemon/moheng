// 从 Hana 1.1.35 的 new-warm-paper-fonts.css 提取 Noto Serif SC 的 @font-face 声明，
// 改写 font-family 为 MH Serif SC、路径指向本地 /fonts/hana/，输出到 hana-serif-fonts.css
import { readFileSync, writeFileSync } from 'node:fs';

const D = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0';
const src = readFileSync(`${D}/themes/new-warm-paper-fonts.css`, 'utf8');
const blocks = [...src.matchAll(/@font-face\s*\{[^{}]*\}/g)].map((m) => m[0]);

const out = [];
for (const b of blocks) {
  const fam = (b.match(/font-family:\s*'([^']+)'/) || [])[1];
  if (fam !== 'Noto Serif SC') continue;
  const weight = (b.match(/font-weight:\s*(\d+)/) || [])[1];
  const style = (b.match(/font-style:\s*(\w+)/) || [])[1] || 'normal';
  const url = (b.match(/url\('\.\/([^']+)'\)/) || [])[1];
  const range = (b.match(/unicode-range:\s*([^;]+);/) || [])[1];
  if (!url || !range) continue;
  out.push(
    '@font-face {\n' +
      '  font-family: "MH Serif SC";\n' +
      `  font-style: ${style};\n` +
      `  font-weight: ${weight};\n` +
      '  font-display: swap;\n' +
      `  src: url("/fonts/hana/${url}") format("woff2");\n` +
      `  unicode-range: ${range.trim()};\n` +
      '}'
  );
}

const header =
  '/* Hana 1.1.35 Noto Serif SC 五档字重（300/400/500/600/700）unicode-range 切片\n' +
  '   来源：reference/hana-1.1.35/themes/new-warm-paper-fonts.css\n' +
  '   字体文件：public/fonts/hana/（99 个 woff2，5.72MB，五档共用同一批切片）\n' +
  '   授权：Noto Serif SC 为 SIL Open Font License 1.1\n' +
  '   用途：标题字体 --font-heading 的真实字重，替代此前的伪加粗 */\n\n';

writeFileSync('D:/WorkSpace/hana/moheng/apps/web/src/styles/hana-serif-fonts.css', header + out.join('\n\n') + '\n', 'utf8');
console.log('faces=' + out.length);
