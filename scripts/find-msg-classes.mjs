// 找消息里的名字标签与正文容器的类名（从 JS 的 classNames 映射表挖）
import { readFileSync } from 'node:fs';

const src = 'C:/Users/leema/.hanako/artifacts/renderer/1.1.35-beta-win32-x64-078ca969122e698c-gb3eb2688cf11fdd0/assets';
const js = readFileSync(`${src}/ChatTranscript-BhjBc-kF.js`, 'utf8');

// 提取 classNames 映射对象：{key:"_key_hash",...}
const start = js.indexOf('avatarRow:');
if (start > 0) {
  console.log('=== classNames 映射表（avatar 附近） ===');
  console.log(js.slice(Math.max(0, start - 1400), start + 2200).replace(/\s+/g, ' '));
}
