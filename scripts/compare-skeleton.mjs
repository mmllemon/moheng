// 骨架对比：hana vs moheng 在「布局骨架」层面的实际差异
// 不看 token，看选择器 + 盒模型规则
import { readFileSync } from 'node:fs';
import fs from 'node:fs';

const HANA = 'D:/WorkSpace/hana/moheng/reference/hana-1.1.35/styles.css';
const MOHENG_DIR = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';

// 解析 CSS 为 [{ sel, decls, line, file }]
function parseCss(path, fileLabel) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    // 跳过 at-rule 头部、注释
    if (!trimmed || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('//')) { i++; continue; }
    if (trimmed.startsWith('@')) {
      // 单行 at-rule 如 @media print{...}
      if (trimmed.includes('{') && trimmed.includes('}')) { i++; continue; }
      i++; continue;
    }
    if (trimmed.includes('{') && !trimmed.startsWith('}')) {
      const sel = trimmed.slice(0, trimmed.indexOf('{')).replace(/\s+/g, ' ').trim();
      // 找闭合
      let depth = (trimmed.match(/\{/g) || []).length - (trimmed.match(/\}/g) || []).length;
      const decls = [];
      // 同一行内的声明
      const inline = trimmed.slice(trimmed.indexOf('{') + 1, trimmed.lastIndexOf('}'));
      if (inline && inline.includes(':')) decls.push(...inline.split(';').map((d) => d.trim()).filter(Boolean));
      let j = i + 1;
      while (j < lines.length && depth > 0) {
        const l = lines[j].trim();
        depth += (l.match(/\{/g) || []).length - (l.match(/\}/g) || []).length;
        if (l === '}' || l.startsWith('}')) { if (depth <= 0) break; }
        if (l && !l.startsWith('/*') && !l.startsWith('@') && l.includes(':')) {
          decls.push(...l.replace(/\}.*$/, '').split(';').map((d) => d.trim()).filter(Boolean));
        }
        j++;
      }
      if (sel && decls.length) out.push({ sel, decls, line: i + 1, file: fileLabel });
      i = j;
      continue;
    }
    i++;
  }
  return out;
}

// 提取布局相关声明
const LAYOUT_PROPS = /^(display|flex|flex-direction|flex-wrap|flex-grow|flex-shrink|flex-basis|grid|grid-template|grid-area|gap|row-gap|column-gap|align-items|align-content|align-self|justify-content|justify-items|justify-self|width|min-width|max-width|height|min-height|max-height|margin|margin-top|margin-right|margin-bottom|margin-left|padding|padding-top|padding-right|padding-bottom|padding-left|position|top|right|bottom|left|overflow|overflow-x|overflow-y|z-index|order|inset)($|:|-)/;

function layoutOf(decls) {
  const out = {};
  for (const d of decls) {
    const idx = d.indexOf(':');
    if (idx < 0) continue;
    const prop = d.slice(0, idx).trim();
    const val = d.slice(idx + 1).replace(/!important/, '').trim();
    if (LAYOUT_PROPS.test(prop)) out[prop] = val.replace(/\s+/g, ' ');
  }
  return out;
}

const hana = parseCss(HANA, 'hana');
const moheng = [
  ...parseCss(`${MOHENG_DIR}/hana.css`, 'hana.css'),
  ...parseCss(`${MOHENG_DIR}/legacy.css`, 'legacy.css'),
  ...parseCss(`${MOHENG_DIR}/v6.css`, 'v6.css'),
];

console.log(`hana 规则数: ${hana.length}`);
console.log(`moheng 规则数: ${moheng.length}\n`);

// 骨架类选择器（非业务专有）
const SKELETON = [
  '.app', '.app-shell', '.main-content', '.main-shell', '.chat-area',
  '.sidebar', '.sidebar-inner', '.sidebar-header', '.sidebar-footer',
  '.titlebar', '.topbar', '.page-header', '.content', '.page-body',
];

console.log('=== 骨架选择器的布局声明对比 ===\n');
for (const sel of SKELETON) {
  const h = hana.find((r) => r.sel === sel);
  const m = moheng.filter((r) => r.sel === sel);
  if (!h && !m.length) continue;

  console.log(`【${sel}】`);
  const hl = h ? layoutOf(h.decls) : null;
  const ml = {};
  for (const r of m) Object.assign(ml, layoutOf(r.decls));
  if (!Object.keys(ml).length && m.length) {
    // 有规则但没有布局声明
    console.log('  hana  : ' + (hl ? JSON.stringify(hl) : '（无此选择器）'));
    console.log('  moheng: （有此规则，但无布局声明）');
  } else {
    const keys = new Set([...(hl ? Object.keys(hl) : []), ...Object.keys(ml)]);
    let same = 0, diff = 0, onlyH = 0, onlyM = 0;
    const rows = [];
    for (const k of keys) {
      const a = hl ? hl[k] : undefined;
      const b = ml[k];
      if (a === b) { same++; continue; }
      if (a && !b) { onlyH++; rows.push(`    ${k.padEnd(16)} hana=${a}  (moheng 无)`); }
      else if (!a && b) { onlyM++; rows.push(`    ${k.padEnd(16)} moheng=${b}  (hana 无)`); }
      else { diff++; rows.push(`    ${k.padEnd(16)} hana=${a}  ≠  moheng=${b}`); }
    }
    console.log(`  相同 ${same} / 不同 ${diff} / 仅 hana ${onlyH} / 仅 moheng ${onlyM}`);
    for (const r of rows.slice(0, 8)) console.log(r);
  }
  console.log('');
}
