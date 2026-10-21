// 提取 v6.css 里决定输入框皮肤的那条规则全文
import { readFileSync } from 'node:fs';

const css = readFileSync('D:/WorkSpace/hana/moheng/apps/web/src/styles/v6.css', 'utf8');
const key = 'input:not([type=checkbox]):not([type=radio]),select,textarea';
const i = css.indexOf(key);
if (i < 0) {
  // 尝试带引号的写法
  const key2 = 'input:not([type="checkbox"]):not([type="radio"]),select,textarea';
  const j = css.indexOf(key2);
  console.log(j < 0 ? '两种写法都未找到' : css.slice(j, j + 600));
} else {
  console.log(css.slice(Math.max(0, i - 40), i + 600));
}
