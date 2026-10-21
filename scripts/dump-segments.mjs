import { readFileSync } from 'node:fs';

const DIR = 'D:/WorkSpace/hana/hana-seed/renderer/assets/';

const TARGETS = [
  ['CardShell-B3PSoerL.css', ['_tabs_22ed1', '_tab_72cc3', '_tabSlider_f4978', '_tabClose_95e62', '_tabMarker_de88b']],
  ['ChatTranscript-DhOABhoU.css', ['_tileTopTitleSegment_612c0', '_fileOutputActionButton_56415', '_fileOutputActionPrimary_13cfc', '_fileOutputActionMenuButton_dc36e']],
  ['app-host-view-uwLKPd1O.css', ['_close_cd3c9']],
];

function parse(css) {
  const s = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const stack = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '{') { stack.push(buf.trim()); buf = ''; }
    else if (ch === '}') {
      const body = buf.trim();
      const sel = stack.pop() || '';
      buf = '';
      if (body && sel && !sel.startsWith('@')) out.push({ sel: sel.replace(/\s+/g, ' '), body });
    } else buf += ch;
  }
  return out;
}

for (const [file, names] of TARGETS) {
  const rules = parse(readFileSync(DIR + file, 'utf8'));
  console.log(`\n${'='.repeat(76)}\n${file}\n${'='.repeat(76)}`);
  for (const name of names) {
    const hit = rules.filter((r) => r.sel.includes(name));
    if (!hit.length) { console.log(`\n  ${name}  —— 未找到`); continue; }
    console.log(`\n### ${name}`);
    for (const r of hit) {
      const d = {};
      for (const p of r.body.split(';')) {
        const i = p.indexOf(':');
        if (i < 0) continue;
        d[p.slice(0, i).trim()] = p.slice(i + 1).trim();
      }
      const geo = ['display', 'height', 'width', 'min-height', 'min-width', 'padding',
        'border-radius', 'font-size', 'gap', 'background', 'color', 'border',
        'justify-content', 'align-items', 'flex', 'position', 'transition', 'opacity'];
      const lines = geo.filter((k) => d[k]).map((k) => `${k}: ${d[k]}`);
      if (!lines.length) continue;
      console.log(`  ${r.sel.slice(0, 96)}`);
      for (const l of lines) console.log(`      ${l}`);
    }
  }
}
