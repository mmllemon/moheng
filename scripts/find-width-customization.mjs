// 找 hana 的内容宽度自定义机制
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35';

// 1. 在 locale 里找宽度相关文案
console.log('=== locale 里的宽度文案 ===\n');
const zh = JSON.parse(readFileSync(`${dir}/locales/zh.json`, 'utf8'));
const walk = (obj, path = '') => {
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'object' && v) walk(v, `${path}${k}.`);
    else if (typeof v === 'string' && /宽度|宽屏|窄屏|列宽|measure|width/i.test(v)) {
      console.log(`  ${path}${k} = ${v.slice(0, 60)}`);
    }
  }
};
walk(zh);

// 2. 在 CSS 里找 data-* 宽度属性
console.log('\n\n=== CSS 里的 data-*width 属性 ===\n');
const cssFiles = readdirSync(`${dir}/assets`).filter((f) => f.endsWith('.css'));
const found = new Set();
for (const f of cssFiles) {
  const css = readFileSync(`${dir}/assets/${f}`, 'utf8');
  const ms = css.match(/\[data-[\w-]*(?:width|measure|column)[\w-]*(?:="[^"]*")?\]/gi);
  if (ms) for (const m of ms) found.add(m);
}
// 也查 styles.css
const main = readFileSync(`${dir}/styles.css`, 'utf8');
const ms2 = main.match(/\[data-[\w-]*(?:width|measure|column)[\w-]*(?:="[^"]*")?\]/gi);
if (ms2) for (const m of ms2) found.add(m);

for (const m of [...found].sort()) console.log(`  ${m}`);

// 3. --chat-column-width 的所有取值
console.log('\n\n=== --chat-column-width 的所有取值 ===\n');
for (const f of [...cssFiles, 'styles.css']) {
  const p = f === 'styles.css' ? `${dir}/styles.css` : `${dir}/assets/${f}`;
  const css = readFileSync(p, 'utf8');
  const ms = css.match(/--chat-column-width\s*:\s*[^;}]+/g);
  if (ms) for (const m of ms) console.log(`  [${f}] ${m}`);
}
