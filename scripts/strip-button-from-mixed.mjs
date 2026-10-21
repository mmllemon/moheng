// 从混合规则里摘掉 .button 选择器，保留其它组件
import { readFileSync, writeFileSync } from 'node:fs';

const PATHS = [
  'D:/WorkSpace/hana/moheng/apps/web/src/styles/legacy.css',
];

// 精确的选择器改写：旧 → 新
const REWRITES = [
  {
    from: '.button:hover:not(:disabled), .icon-button:hover:not(:disabled), .notification-button:hover:not(:disabled) { transform: translateY(-1px); }',
    to: '.icon-button:hover:not(:disabled), .notification-button:hover:not(:disabled) { transform: translateY(-1px); }',
    why: '按钮悬停上浮 1px 是 V6 的交互语言，Hana 的按钮只变色不位移',
  },
  {
    from: '.button:active:not(:disabled), .icon-button:active:not(:disabled), .notification-button:active:not(:disabled) { transform: translateY(0) scale(.98); }',
    to: '.icon-button:active:not(:disabled), .notification-button:active:not(:disabled) { transform: translateY(0) scale(.98); }',
    why: '同上，按下缩放留给图标按钮',
  },
  {
    from: '.button:active:not(:disabled), .icon-button:active:not(:disabled), .notification-button:active:not(:disabled), .ui-theme-choice:active, .ui-pref-toggle:active { transform: scale(.96); }',
    to: '.icon-button:active:not(:disabled), .notification-button:active:not(:disabled), .ui-theme-choice:active, .ui-pref-toggle:active { transform: scale(.96); }',
    why: '同上',
  },
];

for (const path of PATHS) {
  let css = readFileSync(path, 'utf8');
  const name = path.split('/').pop();
  console.log(`\n${name}`);

  for (const r of REWRITES) {
    if (!css.includes(r.from)) {
      console.log(`  · 未匹配（可能已改）：${r.from.slice(0, 60)}…`);
      continue;
    }
    css = css.replace(r.from, r.to);
    console.log(`  ✓ ${r.why}`);
  }

  // 第 1、4 条是 transition 声明，按钮保留 transition 无害（Hana 的按钮也有 transition），
  // 但 .button 现在由 hana.css 定义 transition，旧层这条会覆盖。
  // 检查 hana.css 的 transition 是否被旧层盖住。
  writeFileSync(path, css, 'utf8');
}

console.log('\n完成');
