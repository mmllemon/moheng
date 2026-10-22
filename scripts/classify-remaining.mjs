// 给剩下 10 个未接入 harness 的脚本分类：是否真的需要登录
import { readFileSync } from 'node:fs';

const REMAINING = [
  'axe-audit.mjs', 'compare-layer-shots.mjs', 'debug-legacy-parse.mjs', 'diff-screenshots.mjs',
  'hana-layout-probe.mjs', 'inspect-layer-rules.mjs', 'inspect-stylesheets.mjs',
  'probe-corner-shape.mjs', 'test-layer-dependency.mjs', 'verify-strip-works.mjs',
];

for (const f of REMAINING) {
  const text = readFileSync(`D:/WorkSpace/hana/moheng/scripts/${f}`, 'utf8');
  const urls = [...text.matchAll(/(?:goto|goto_)\s*\(\s*(?:BASE\s*\+\s*)?['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const hasLoginForm = /input\[type=email\]|input\[type=password\]/.test(text);
  const usesLocalApp = /localhost:5173|BASE\s*\+\s*['"]/.test(text);
  const usesHana = /127\.0\.0\.1:88|hana-seed|hana/i.test(text.slice(0, 2000));
  const isStaticAnalysis = !/chromium\.launch/.test(text) || /setContent/.test(text);

  let kind;
  if (hasLoginForm) kind = '需登录（应接入）';
  else if (usesHana) kind = '读 Hana 参考（不需登录）';
  else if (isStaticAnalysis) kind = '纯静态/读文件（不需登录）';
  else if (usesLocalApp) kind = '访问应用但未登录（可疑）';
  else kind = '其它';

  console.log(`\n${f}`);
  console.log(`  判定: ${kind}`);
  if (urls.length) console.log(`  导航: ${[...new Set(urls)].slice(0, 5).join(', ')}`);
}
