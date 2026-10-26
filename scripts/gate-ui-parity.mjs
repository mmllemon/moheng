#!/usr/bin/env node
// 门禁聚合入口：把一个脚本的「通过 / 失败 / 未就绪」三态，转成发布门禁能理解的二者。
//
// 为什么需要这一层：
//   本仓库的 validate-ui-parity 在缺少输入时会输出 SKIP 并 exit 0 —— 那是正确的
//   本地行为（不该因为没跑过浏览器就报错），但对发布门禁来说，exit 0 等于"通过"。
//   如果直接把它接进 validate:release-candidate，门禁就会在从未执行时静默放行。
//
//   本包装器的职责就是堵住这个洞：
//     - 未就绪（SKIP）默认算失败
//     - 只有显式声明 PARITY_NOT_REQUIRED=1 才放行，且必须打印醒目警告
//
// 用法：
//   node scripts/gate-ui-parity.mjs
//   node scripts/gate-ui-parity.mjs --require          # 强制要求已跑过
//   PARITY_NOT_REQUIRED=1 node scripts/gate-ui-parity.mjs   # 显式接受"桌面端未就绪"
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const WEB = 'docs/gates/ui-parity/web.json';
const ELECTRON = 'docs/gates/ui-parity/electron.json';

const explicitNotRequired = process.env.PARITY_NOT_REQUIRED === '1';

// 先看输入齐不齐，避免 spawn 一个注定 SKIP 的子进程
const missing = [WEB, ELECTRON].filter((path) => !existsSync(path));

if (missing.length) {
  console.log('双 target 一致性门禁：缺少结果文件');
  for (const path of missing) console.log('  - ' + path);
  console.log('');
  console.log('生成结果：npm run ui:parity（需要 API 在 3001 上运行）');

  if (explicitNotRequired) {
    console.log('');
    console.log('⚠ PARITY_NOT_REQUIRED=1 已设置，本次放行。');
    console.log('⚠ 这意味着桌面端一致性**未经任何验证**。发布说明中必须写明这一点。');
    process.exit(0);
  }

  console.log('');
  console.log('判定：失败。');
  console.log('');
  console.log('如果桌面端尚未开始、确实无法生成结果，请显式声明：');
  console.log('  PARITY_NOT_REQUIRED=1 npm run validate:release-candidate');
  console.log('不要用删除检查的方式绕过 —— 那会让这条门禁永久失效。');
  process.exit(1);
}

// 输入齐全，交给真正的判等脚本
const result = spawnSync(process.execPath, ['scripts/validate-ui-parity.mjs'], {
  stdio: 'inherit',
  env: { ...process.env, HISTORICAL: '1' },
});

if (result.error) {
  console.error('启动 validate-ui-parity 失败:', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
