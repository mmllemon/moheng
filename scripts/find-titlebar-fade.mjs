// 在 33 个组件 CSS 里找顶栏虚化/渐变遮罩
import { readdirSync, readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

const KEYS = ['titlebar', 'TitleBar', 'title-bar', 'chat-area', 'scroll-fade', 'fade-mask', 'mask-image', 'maskImage'];

for (const f of files) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  const found = KEYS.filter((k) => css.includes(k));
  if (!found.length) continue;
  console.log(`\n[${f}] 含: ${found.join(', ')}`);

  // 拆规则，找 mask / gradient / backdrop
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css))) {
    const sel = m[1].trim();
    const body = m[2];
    if (!/mask|gradient|backdrop|filter/i.test(body)) continue;
    const hits = body.split(';').filter((d) => /mask|gradient|backdrop/i.test(d));
    if (hits.length) {
      console.log(`  ${sel.slice(0, 66)}`);
      for (const h of hits) console.log(`      ${h.trim().slice(0, 110)}`);
    }
  }
}
