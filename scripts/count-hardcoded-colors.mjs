// 统计各样式表里的硬编码颜色（不经过 token 的绝对色值）
import { readFileSync, readdirSync } from 'node:fs';

const dir = 'D:/WorkSpace/hana/moheng/apps/web/src/styles';
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

// 十六进制、rgb()、hsl()、具名色；排除变量定义行（以 -- 开头）
const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\s*\([^)]+\)/g;
const HSL = /\bhsla?\s*\([^)]+\)/g;

for (const f of files) {
  const text = readFileSync(`${dir}/${f}`, 'utf8');
  const lines = text.split('\n');

  let hexN = 0, rgbN = 0, hslN = 0;
  const samples = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // 变量定义行不算（那是 token 的源头）
    if (/^--[\w-]+\s*:/.test(trimmed)) continue;
    // 注释行跳过
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    const h = (line.match(HEX) || []).filter((v) => !/^#[\w-]+\s*:/.test(line));
    const r = line.match(RGB) || [];
    const s = line.match(HSL) || [];

    if (h.length || r.length || s.length) {
      hexN += h.length; rgbN += r.length; hslN += s.length;
      if (samples.length < 3) samples.push(trimmed.slice(0, 90));
    }
  }
  const total = hexN + rgbN + hslN;
  if (total > 0) {
    console.log(`${f.padEnd(26)} hex ${String(hexN).padStart(4)}  rgb ${String(rgbN).padStart(4)}  hsl ${String(hslN).padStart(3)}  合计 ${String(total).padStart(5)}`);
  }
}
