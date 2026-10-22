// 找 titlebar 实体的背景：--titlebar-surface-bg 被谁用作 background
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/assets';

for (const f of readdirSync(dir).filter((x) => x.endsWith('.css'))) {
  const css = readFileSync(`${dir}/${f}`, 'utf8');
  if (!css.includes('titlebar-surface-bg')) continue;
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    const close = css.indexOf('}', open);
    if (close < 0) break;
    const body = css.slice(open + 1, close);
    // 只看真正把该变量用作背景的规则
    if (/background[^;]*titlebar-surface-bg/.test(body)) {
      console.log(`\n【${sel.slice(0, 110)}】`);
      for (const d of body.split(';')) {
        const s = d.trim();
        if (s) console.log(`    ${s.slice(0, 92)}`);
      }
    }
    i = close + 1;
  }
}
