#!/usr/bin/env node
// 门禁元自检：确认"检查本身"没有失效。
//
// 为什么需要它：
//   本仓库已出现过两次同类问题：
//     1. validate-ui-polish.mjs 断言的是 moheng 自改的 --accent，不是 Hana 真值
//     2. validate-typescript-fixes.mjs 断言 auth-store.ts 含有某段类型标注，但该标注已不存在
//   两次都是"检查在跑、结果在绿、但实际没在验证任何东西"。
//
//   这类失效有个共同点：断言依赖的**源码文本**或**输入文件**变了，断言没有跟着变。
//   本脚本把这种失效变成显式的红灯，而不是静默的绿灯。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const failures = [];
const warnings = [];
let passed = 0;

function check(label, ok, detail) {
  if (ok) {
    passed += 1;
    console.log('PASS ' + label);
  } else {
    failures.push({ label, detail });
    console.log('FAIL ' + label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
  }
}

function warn(label, detail) {
  warnings.push({ label, detail });
  console.log('WARN ' + label + (detail ? ' :: ' + JSON.stringify(detail) : ''));
}

// ---- 1. 双 target 门禁自检：门禁必须会因差异而失败 ----
// selftest-ui-parity.mjs 注入 5 种人造差异，逐一确认被抓住。
{
  let ok = false;
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/selftest-ui-parity.mjs'], { encoding: 'utf8' });
    ok = true;
  } catch (error) {
    out = (error.stdout ?? '') + (error.stderr ?? '');
    ok = false;
  }
  const allCorrect = /全部 \d+ 个案子行为正确/.test(out);
  check('双 target 门禁能被注入的差异触发失败', ok && allCorrect, {
    tail: out.trim().split('\n').slice(-1)[0],
  });
}

// ---- 2. 双 target 门禁的输入缺失时不得报"通过" ----
// 这是本轮修过的一个真实缺陷：SKIP 之后曾打印"全部通过"。
{
  let out = '';
  try {
    out = execFileSync(process.execPath, ['scripts/validate-ui-parity.mjs'], {
      encoding: 'utf8',
      env: { ...process.env, RESULT_DIR: 'docs/gates/__nonexistent__' },
    });
  } catch (error) {
    out = (error.stdout ?? '') + (error.stderr ?? '');
  }
  const claimsPass = /全部通过/.test(out) || /一致性检查全部通过/.test(out);
  const saysSkipped = /未进行比对|缺少结果文件/.test(out);
  check('双 target 门禁在输入缺失时不谎报通过', saysSkipped && !claimsPass, {
    claimsPass,
    saysSkipped,
    tail: out.trim().split('\n').filter(Boolean).slice(-1)[0],
  });
}

// ---- 3. 运行环境契约必须被真实执行过（输入是产物，不是源码） ----
// 契约测试是纯函数单测，必须能跑通；端到端验证需要数据库，不在此强制。
{
  let ok = false;
  let out = '';
  try {
    out = execFileSync(
      'npx',
      ['tsx', '--test', 'src/platform/runtime-contract.test.ts'],
      { cwd: 'apps/api', encoding: 'utf8', shell: process.platform === 'win32' }
    );
    ok = true;
  } catch (error) {
    out = (error.stdout ?? '') + (error.stderr ?? '');
    ok = false;
  }
  check('运行环境契约单测可通过', ok, { tail: out.trim().split('\n').slice(-3).join(' | ') });
}

// ---- 4. 检查"断言依赖的源码是否还在"：防止断言静默失效 ----
// 这里只做抽样，列出已知脆弱点。新增检查时应把依赖补进来。
//
// 三类状态：
//   PASS  断言依赖在源码中，且与预期一致
//   WARN  断言依赖不在源码中（断言可能已失效）
//   WARN  断言依赖存在但属“有意偏离”，需人工确认偏离仍成立
const fragileAssertions = [
  {
    script: 'scripts/validate-typescript-fixes.mjs',
    label: 'auth-store.ts 的 UiTheme 类型标注',
    file: 'apps/web/src/auth-store.ts',
    pattern: "UiTheme | 'light' | 'dark'",
    // 该片段已改为“先 string 读入再枚举收窄”，属实现升级，断言已跟着修正
    note: '实现已升级为 string → 枚举收窄；断言已在 2026-10-23 同步更新。此处预期为 WARN。',
  },
  {
    script: 'scripts/validate-ui-polish.mjs',
    label: 'hana.css 的 accent token',
    file: 'apps/web/src/styles/hana.css',
    pattern: '--accent: #466b80',
    // 这是墨衡有意偏离 Hana 真值的值（WCAG AA 需要），断言存在但需人工确认偏离仍成立
    intentionalDeviation: {
      hanaValue: '#537D96',
      reason: '10–12px 文字/链接/主按钮需达到 WCAG AA 4.5:1',
    },
  },
];

for (const item of fragileAssertions) {
  const { readFileSync } = await import('node:fs');
  if (!existsSync(item.file)) {
    check(`${item.label} 依赖的文件存在`, false, { file: item.file });
    continue;
  }
  const content = readFileSync(item.file, 'utf8');
  const present = content.includes(item.pattern);

  if (!present) {
    warn(`${item.label} 已不在源码中（${item.script} 对应断言可能已失效）`, {
      file: item.file,
      expected: item.pattern,
      consequence: '该断言会稳定失败或稳定通过，但都不反映真实行为',
      note: item.note,
    });
    continue;
  }

  if (item.intentionalDeviation) {
    // 断言在，但它验证的是一个故意偏离 Hana 真值的值。
    // 这不是失败，但必须让人看见——否则“复刻完成度”会被高估。
    warn(`${item.label} 是故意偏离 Hana 真值的值，需人工确认偏离仍成立`, {
      file: item.file,
      mohengValue: item.pattern,
      hanaValue: item.intentionalDeviation.hanaValue,
      reason: item.intentionalDeviation.reason,
    });
  } else {
    passed += 1;
    console.log('PASS ' + item.label + ' 仍存在于源码中');
  }
}

console.log('');
if (failures.length) {
  console.log(`${failures.length} 项门禁元自检失败，${passed} 项通过，${warnings.length} 项警告。`);
  process.exitCode = 1;
} else {
  console.log(`${passed} 项通过，${warnings.length} 项警告。`);
  if (warnings.length) {
    console.log('');
    console.log('警告项不阻断发布，但意味着对应断言可能已失效，需要人工确认。');
  }
  process.exitCode = 0;
}
