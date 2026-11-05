// 门禁自检：注入人造差异，确认 validate-ui-parity.mjs 真的会失败。
// 一个从不失败的门禁等于没有门禁 —— 这是必须验证的事。
//
// 2026-11-05：第二 target 从 electron 改成 legacy（另一个 Chromium 构建），
// 因此新增两类案子：同引擎冒充第二 target 必须失败；旧内核的 squircle 退化必须被如实记录
// 而不是当成差异判红。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const WEB = 'docs/gates/ui-parity/web.json';
const base = JSON.parse(readFileSync(WEB, 'utf8'));
// web 侧声明引擎：系统 Chrome
base.raw.web.env.engine = { requested: 'web', runtime: 'chrome', signature: 'chrome:156', executable: 'chrome.exe' };

const tmp = mkdtempSync(join(tmpdir(), 'uiparity-'));
const cases = [];

function writeCase(name, legacy, expect) {
  cases.push({ name, legacy, expect, dir: join(tmp, name) });
}

// 克隆一份 web 结果作为"完美的 legacy"
function perfectLegacy() {
  const clone = JSON.parse(JSON.stringify(base));
  clone.raw.legacy = clone.raw.web;
  clone.summarize.legacy = clone.summarize.web;
  delete clone.raw.web;
  delete clone.summarize.web;
  clone.target = 'legacy';
  const engine = { requested: 'legacy', runtime: 'chromium', signature: 'chromium:149', executable: 'playwright-bundled-chromium' };
  clone.raw.legacy.env.engine = engine;
  clone.summarize.legacy.engine = engine;
  clone.raw.legacy.env.chromiumMajor = 149;
  clone.summarize.legacy.chromiumMajor = 149;
  return clone;
}

// 基线：完全一致 → 应通过
writeCase('identical', perfectLegacy(), 'pass');

// 差异1：某个路由 rounded 掉 1（squircle 少生效一处）
{
  const e = perfectLegacy();
  e.raw.legacy.routes.find((r) => r.route === '/cost/budget').rounded -= 1;
  writeCase('rounded-off-by-one', e, 'fail');
}

// 差异2：legacy 的 Chromium 旧到不支持 squircle —— 这是被跟踪的退化，不应判红，
// 但必须把 cornerShapeAccepted 一并变成 false（真实旧内核就是这样）。
{
  const e = perfectLegacy();
  e.raw.legacy.env.chromiumMajor = 126;
  e.summarize.legacy.chromiumMajor = 126;
  e.raw.legacy.env.cornerShapeSupported = false;
  e.summarize.legacy.cornerShapeSupported = false;
  for (const row of e.raw.legacy.routes) row.cornerShapeAccepted = false;
  writeCase('squircle-degraded', e, 'pass');
}

// 差异3：声称内核太旧，但 cornerShapeAccepted 又全是 true（数据自相矛盾）→ 应失败
{
  const e = perfectLegacy();
  e.raw.legacy.env.chromiumMajor = 126;
  e.summarize.legacy.chromiumMajor = 126;
  e.raw.legacy.env.cornerShapeSupported = false;
  e.summarize.legacy.cornerShapeSupported = false;
  writeCase('degraded-but-accepted', e, 'fail');
}

// 差异4：外壳度量偏差 1px（侧栏 x 从 6 变 7）
{
  const e = perfectLegacy();
  e.raw.legacy.shell.sidebar.x = 7;
  writeCase('shell-off-by-one', e, 'fail');
}

// 差异5：legacy 侧自己有一个失败项
{
  const e = perfectLegacy();
  e.summarize.legacy.failureCount = 1;
  e.summarize.legacy.failures = [{ check: 'chromium-too-old-for-squircle' }];
  writeCase('target-self-failure', e, 'fail');
}

// 差异6：焦点陷阱行为不同
{
  const e = perfectLegacy();
  e.raw.legacy.dialog.trapped = false;
  writeCase('focus-trap-differs', e, 'fail');
}

// 差异7：legacy 其实还是 web 那个浏览器（同签名）→ 必须被引擎守卫拦下
{
  const e = perfectLegacy();
  const sameEngine = { requested: 'legacy', runtime: 'chrome', signature: 'chrome:156', executable: 'chrome.exe' };
  e.raw.legacy.env.engine = sameEngine;
  e.summarize.legacy.engine = sameEngine;
  writeCase('same-engine-stub', e, 'fail');
}

console.log('逐案验证门禁是否会失败：\n');
let wrong = 0;

for (const testCase of cases) {
  mkdirSync(testCase.dir, { recursive: true });
  writeFileSync(join(testCase.dir, 'web.json'), JSON.stringify(base));
  writeFileSync(join(testCase.dir, 'legacy.json'), JSON.stringify(testCase.legacy));

  let code = 0;
  let output = '';
  try {
    output = execFileSync(process.execPath, ['scripts/validate-ui-parity.mjs'], {
      env: { ...process.env, RESULT_DIR: testCase.dir },
      encoding: 'utf8',
    });
    code = 0;
  } catch (error) {
    code = error.status ?? 1;
    output = (error.stdout ?? '') + (error.stderr ?? '');
  }

  const shouldFail = testCase.expect === 'fail';
  const didFail = code !== 0;
  const ok = shouldFail === didFail;
  if (!ok) wrong += 1;

  console.log(`${ok ? 'OK  ' : 'BAD '} ${testCase.name.padEnd(24)} 期望${shouldFail ? '失败' : '通过'} 实际${didFail ? '失败' : '通过'}`);
  if (!ok) console.log('    输出片段: ' + output.split('\n').filter((l) => l.startsWith('FAIL') || l.startsWith('SKIP')).slice(0, 3).join(' | '));
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (wrong) {
  console.log(`${wrong} 个案子的门禁行为不符合预期。`);
  process.exitCode = 1;
} else {
  console.log(`全部 ${cases.length} 个案子行为正确：一致则通过，任一差异则失败。`);
}
