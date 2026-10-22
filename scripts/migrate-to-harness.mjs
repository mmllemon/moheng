// 批量替换登录代码为标准 harness 调用
// 策略：只认「goto login + fill email + fill password + click submit + waitForTimeout」这五句，
// 它们逐字高度一致；用正则跨行替换，不碰上下文变量名
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/scripts';
const backupDir = 'D:/WorkSpace/hana/moheng/scripts/.bak-login';
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));

// 匹配整段登录流程（允许中间有空白/换行差异）
// 支持多种 page 变量名（p / page 等）和多种 email 选择器
const LOGIN_RE = /await\s+(\w+)\.goto\(\s*(?:BASE\s*\+\s*)?['"]\/login['"][^)]*\);\s*\n\s*await\s+\1\.locator\(\s*['"]input\[type=email\][^'"]*['"]\s*\)\.first\(\)\.fill\(['"][^'"]+['"]\);\s*\n\s*await\s+\1\.locator\(\s*['"]input\[type=password\]['"]\s*\)\.first\(\)\.fill\(['"][^'"]+['"]\);\s*\n\s*await\s+\1\.locator\(\s*['"]button\[type=submit\]['"]\s*\)\.first\(\)\.click\(\);\s*\n\s*await\s+\1\.waitForTimeout\(\s*\d+\s*\);/g;

// 绝对 URL 形式
const LOGIN_RE_ABS = /await\s+(\w+)\.goto\(\s*['"]http:\/\/localhost:5173\/login['"][^)]*\);\s*\n\s*await\s+\1\.locator\(\s*['"]input\[type=email\][^'"]*['"]\s*\)\.first\(\)\.fill\(['"][^'"]+['"]\);\s*\n\s*await\s+\1\.locator\(\s*['"]input\[type=password\]['"]\s*\)\.first\(\)\.fill\(['"][^'"]+['"]\);\s*\n\s*await\s+\1\.locator\(\s*['"]button\[type=submit\]['"]\s*\)\.first\(\)\.click\(\);\s*\n\s*await\s+\1\.waitForTimeout\(\s*\d+\s*\);/g;

const results = [];
for (const f of files) {
  const path = `${dir}/${f}`;
  let text = readFileSync(path, 'utf8');
  if (!text.includes('chromium.launch')) continue;
  if (text.includes("from './_harness.mjs'")) continue;

  const orig = text;
  let replaced = 0;

  text = text.replace(LOGIN_RE_ABS, (m, p) => { replaced++; return `await login(${p});`; });
  text = text.replace(LOGIN_RE, (m, p) => { replaced++; return `await login(${p});`; });

  if (!replaced) { results.push({ f, status: '未匹配' }); continue; }

  // 补 import：找到第一处 from 'playwright-core' 的 import，在后面加
  if (!text.includes("from './_harness.mjs'")) {
    const m = text.match(/^import\s+\{[^}]*\}\s+from\s+['"]playwright-core['"];?\s*$/m);
    if (m) {
      const names = ['login'];
      // 判断是否需要 BASE / CHROME
      if (text.includes('BASE') && !/const\s+BASE\s*=/.test(text)) names.push('BASE');
      if (text.includes('CHROME') && !/const\s+CHROME\s*=/.test(text)) names.push('CHROME');
      text = text.replace(m[0], `${m[0]}\nimport { ${names.join(', ')} } from './_harness.mjs';`);
    } else {
      results.push({ f, status: '替换了但找不到 import 行' });
      continue;
    }
  }

  copyFileSync(path, `${backupDir}/${f}`);
  writeFileSync(path, text, 'utf8');
  results.push({ f, status: `✓ 替换 ${replaced} 处` });
}

const ok = results.filter((r) => r.status.startsWith('✓'));
const no = results.filter((r) => !r.status.startsWith('✓'));
console.log(`成功 ${ok.length}，未处理 ${no.length}\n`);
for (const r of ok) console.log(`  ${r.f.padEnd(38)} ${r.status}`);
if (no.length) {
  console.log('\n未处理:');
  for (const r of no) console.log(`  ${r.f.padEnd(38)} ${r.status}`);
}
