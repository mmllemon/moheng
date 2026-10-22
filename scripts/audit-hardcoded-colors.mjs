// 深挖：把 legacy/v6 里的硬编码颜色分类，找出真正会在换主题时出问题的
import { readFileSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';

// 从 hana.css 提取各主题的 token 值，用于判断某个硬编码色「是否恰好等于某主题的 token」
function parseThemeTokens(file) {
  const text = readFileSync(file, 'utf8');
  const themes = {};
  const blocks = [
    { name: 'warm-paper', re: /html\[data-theme="warm-paper"\]\s*\{([\s\S]*?)\n\}/ },
    { name: 'plain-white', re: /html\[data-theme="plain-white"\]\s*\{([\s\S]*?)\n\}/ },
    { name: 'midnight', re: /html\[data-theme="midnight"\]\s*\{([\s\S]*?)\n\}/ },
  ];
  for (const { name, re } of blocks) {
    const m = text.match(re);
    if (!m) continue;
    const vars = {};
    for (const line of m[1].split('\n')) {
      const v = line.match(/^\s*(--[\w-]+)\s*:\s*([^;]+);/);
      if (v) vars[v[1]] = v[2].trim();
    }
    themes[name] = vars;
  }
  return themes;
}

const themes = parseThemeTokens(`${dir}/hana.css`);
console.log('=== hana.css 各主题 token 数量 ===');
for (const [t, v] of Object.entries(themes)) console.log(`  ${t}: ${Object.keys(v).length} 个变量`);

// 收集：每个 token 在各主题的值
const tokenValues = {};
for (const [theme, vars] of Object.entries(themes)) {
  for (const [k, v] of Object.entries(vars)) {
    if (!tokenValues[k]) tokenValues[k] = {};
    tokenValues[k][theme] = v;
  }
}

// 找出「各主题取值不同」的 token（这些是主题相关的关键 token）
const varies = Object.entries(tokenValues).filter(([, vals]) => {
  const uniq = new Set(Object.values(vals).map((v) => v.toLowerCase()));
  return uniq.size > 1;
});
console.log(`\n=== 主题敏感 token（各主题取值不同）: ${varies.length} 个 ===`);
const keyTokens = varies.filter(([k]) =>
  /bg|surface|text|border|line|accent|paper|card|ink|meta|shadow/.test(k)
);
console.log('其中关键的:', keyTokens.slice(0, 20).map(([k]) => k).join(' '));

// 现在扫描 legacy/v6 的硬编码色，判断是否命中某主题的 token 值
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\s*\([^)]+\)/g;

function normalize(c) {
  c = c.trim().toLowerCase();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    return `rgb(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)})`;
  }
  const m = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (m) return `rgb(${m[1]}, ${m[2]}, ${m[3]})`;
  return c;
}

// 建反查表：normalized rgb → 哪些 token 在哪些主题下等于它
const lookup = new Map();
for (const [token, vals] of Object.entries(tokenValues)) {
  for (const [theme, v] of Object.entries(vals)) {
    const key = normalize(v);
    if (!key.startsWith('rgb')) continue;
    if (!lookup.has(key)) lookup.set(key, []);
    lookup.get(key).push(`${token}@${theme}`);
  }
}

for (const file of ['legacy.css', 'v6.css']) {
  const text = readFileSync(`${dir}/${file}`, 'utf8');
  const lines = text.split('\n');
  const hits = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (/^--[\w-]+\s*:/.test(trimmed)) continue;
    const found = [...(line.match(HEX) || []), ...(line.match(RGB) || [])];
    for (const c of found) {
      const key = normalize(c);
      if (lookup.has(key)) {
        hits.push({ line: i + 1, color: c, matches: lookup.get(key) });
      }
    }
  }
  console.log(`\n=== ${file}: 命中主题 token 值的硬编码色 ${hits.length} 处 ===`);
  const shown = hits.slice(0, 12);
  for (const h of shown) {
    console.log(`  行${h.line} ${h.color.padEnd(22)} = ${h.matches.slice(0, 2).join(', ')}${h.matches.length > 2 ? ' …' : ''}`);
  }
  if (hits.length > shown.length) console.log(`  … 还有 ${hits.length - shown.length} 处`);

  if (hits.length) {
    const tokens = new Set();
    for (const h of hits) for (const m of h.matches) tokens.add(m.split('@')[0]);
    console.log(`  涉及 token: ${[...tokens].join(' ')}`);
  }
}
