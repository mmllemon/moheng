// 第二轮：覆盖 #email / #password 变体，以及带 if 包裹的登录
import { readFileSync, writeFileSync, readdirSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/scripts';
const backupDir = 'D:/WorkSpace/hana/moheng/scripts/.bak-login';
if (!existsSync(backupDir)) mkdirSync(backupDir, { recursive: true });

const files = readdirSync(dir).filter((f) => f.endsWith('.mjs') && !f.startsWith('_'));

// 宽松版：选择器允许 input[type=email], #email 这类组合；等待时长任意
const EMAIL = `['"]input\\[type=email\\][^'"]*['"]`;
const PASS = `['"]input\\[type=password\\][^'"]*['"]`;

function makeRe(withConditional) {
  const head = withConditional
    ? `if\\s*\\(\\s*\\w+\\.url\\(\\)\\.includes\\(\\s*['"]/login['"]\\s*\\)\\s*\\)\\s*\\{\\s*`
    : '';
  return new RegExp(
    head +
    `await\\s+(\\w+)\\.goto\\(\\s*(?:BASE\\s*\\+\\s*)?['"](?:/login|http://localhost:5173/login)['"][^)]*\\);\\s*` +
    `\\n\\s*await\\s+\\1\\.locator\\(\\s*${EMAIL}\\s*\\)\\.first\\(\\)\\.fill\\(['"][^'"]+['"]\\);\\s*` +
    `\\n\\s*await\\s+\\1\\.locator\\(\\s*${PASS}\\s*\\)\\.first\\(\\)\\.fill\\(['"][^'"]+['"]\\);\\s*` +
    `\\n\\s*await\\s+\\1\\.locator\\(\\s*['"]button\\[type=submit\\]['"]\\s*\\)\\.first\\(\\)\\.click\\(\\);\\s*` +
    `\\n\\s*await\\s+\\1\\.waitForTimeout\\(\\s*\\d+\\s*\\);` +
    (withConditional ? `\\s*\\}` : ''),
    'g'
  );
}

const result = [];
for (const f of files) {
  const path = `${dir}/${f}`;
  let text = readFileSync(path, 'utf8');
  if (!text.includes('chromium.launch')) continue;
  if (text.includes("from './_harness.mjs'") && !text.includes('input[type=email]')) continue;

  let n = 0;
  text = text.replace(makeRe(true), (m, p) => { n++; return `await login(${p});`; });
  text = text.replace(makeRe(false), (m, p) => { n++; return `await login(${p});`; });
  if (!n) { result.push({ f, status: '未匹配' }); continue; }

  if (!text.includes("import { login")) {
    const m = text.match(/^import\s+\{[^}]*\}\s+from\s+['"]playwright-core['"];?\s*$/m);
    if (m) {
      const names = ['login'];
      if (text.includes('BASE') && !/const\s+BASE\s*=/.test(text)) names.push('BASE');
      if (text.includes('CHROME') && !/const\s+CHROME\s*=/.test(text)) names.push('CHROME');
      if (text.includes('ROUTES') && !/const\s+ROUTES\s*=/.test(text)) names.push('ROUTES');
      text = text.replace(m[0], `${m[0]}\nimport { ${names.join(', ')} } from './_harness.mjs';`);
    } else {
      result.push({ f, status: '无 import 行' });
      continue;
    }
  }

  copyFileSync(path, `${backupDir}/${f}`);
  writeFileSync(path, text, 'utf8');
  result.push({ f, status: `✓ ${n} 处` });
}

const ok = result.filter((r) => r.status.startsWith('✓'));
console.log(`成功 ${ok.length}`);
for (const r of ok) console.log(`  ${r.f.padEnd(38)} ${r.status}`);
const no = result.filter((r) => !r.status.startsWith('✓'));
if (no.length) { console.log('\n仍未匹配:'); for (const r of no) console.log(`  ${r.f}`); }
