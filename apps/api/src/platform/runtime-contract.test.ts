import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReadyInfo,
  parseDbScheme,
  resolvePortPolicy,
  validateDatabaseForMode,
} from './runtime-contract.js';

test('parseDbScheme 接受三种合法 scheme', () => {
  assert.equal(parseDbScheme('postgresql://user:pw@127.0.0.1:5432/db'), 'postgresql');
  assert.equal(parseDbScheme('postgres://user:pw@127.0.0.1:5432/db'), 'postgres');
  assert.equal(parseDbScheme('pglite://./data'), 'pglite');
  // 大小写不同视为同一 scheme
  assert.equal(parseDbScheme('PostgreSQL://user@host/db'), 'postgresql');
});

test('parseDbScheme 对无法识别的输入返回 null，而不是猜一个默认值', () => {
  assert.equal(parseDbScheme('mysql://user@host/db'), null);
  assert.equal(parseDbScheme('sqlite:./dev.db'), null);
  assert.equal(parseDbScheme(''), null);
  assert.equal(parseDbScheme('   '), null);
  assert.equal(parseDbScheme('no-scheme-here'), null);
  // 冒号在最前，没有 scheme 名
  assert.equal(parseDbScheme('://host/db'), null);
});

test('standalone 形态拒绝 PORT=0', () => {
  const policy = resolvePortPolicy('standalone');
  const zero = policy.safeParse(0);
  assert.equal(zero.success, false, 'standalone 下 PORT=0 必须被拒绝');
  const message = zero.success ? '' : zero.error.issues.map((issue) => issue.message).join(' ');
  assert.match(message, /random|随机|反向代理/);

  assert.equal(policy.safeParse(3001).success, true);
  assert.equal(policy.safeParse(65535).success, true);
  assert.equal(policy.safeParse(65536).success, false, '超出端口范围必须拒绝');
  assert.equal(policy.safeParse(-1).success, false);
});

test('embedded 形态允许 PORT=0（系统分配空闲端口）', () => {
  const policy = resolvePortPolicy('embedded');
  assert.equal(policy.safeParse(0).success, true, 'embedded 下 PORT=0 是标准做法');
  assert.equal(policy.safeParse(3001).success, true);
  assert.equal(policy.safeParse(65536).success, false);
});

test('embedded 形态对未实现的 pglite 适配器显式拒绝，而不是降级', () => {
  const error = validateDatabaseForMode('embedded', 'pglite');
  assert.ok(error, 'pglite 适配器未接好时必须返回错误，不能返回 null');
  assert.match(error, /pglite/);
  assert.match(error, /静默降级|假成功/);
});

test('embedded 形态接受 postgresql', () => {
  assert.equal(validateDatabaseForMode('embedded', 'postgresql'), null);
  assert.equal(validateDatabaseForMode('embedded', 'postgres'), null);
});

test('standalone 形态拒绝 pglite', () => {
  const error = validateDatabaseForMode('standalone', 'pglite');
  assert.ok(error, 'standalone 下 pglite 必须被拒绝');
  assert.match(error, /DBA|备份|审计/);
});

test('standalone 形态接受 postgresql', () => {
  assert.equal(validateDatabaseForMode('standalone', 'postgresql'), null);
});

test('buildReadyInfo 在 PORT=0 后使用真实端口拼 baseUrl', () => {
  const info = buildReadyInfo({
    host: '127.0.0.1',
    port: 38217,
    mode: 'embedded',
    databaseScheme: 'postgresql',
    version: '2.19.0-rc.2',
    publicMode: false,
  });
  assert.equal(info.baseUrl, 'http://127.0.0.1:38217');
  assert.equal(info.port, 38217);
});

test('buildReadyInfo 对 IPv6 字面量补方括号', () => {
  const info = buildReadyInfo({
    host: '::1',
    port: 8080,
    mode: 'standalone',
    databaseScheme: 'postgresql',
    version: 'x',
    publicMode: false,
  });
  assert.equal(info.baseUrl, 'http://[::1]:8080', 'IPv6 不加方括号会导致 URL 无法解析');
});

test('buildReadyInfo 不会把已带方括号的 IPv6 重复包裹', () => {
  const info = buildReadyInfo({
    host: '[::1]',
    port: 8080,
    mode: 'standalone',
    databaseScheme: 'postgresql',
    version: 'x',
    publicMode: false,
  });
  assert.equal(info.baseUrl, 'http://[::1]:8080');
});

test('就绪信息可被 JSON 往返，桌面端可安全消费', () => {
  const info = buildReadyInfo({
    host: '127.0.0.1',
    port: 12345,
    mode: 'embedded',
    databaseScheme: 'postgresql',
    version: '2.19.0-rc.2',
    publicMode: false,
  });
  const roundTrip = JSON.parse(JSON.stringify(info));
  assert.deepEqual(roundTrip, info);
  // 确保没有把数据库密码之类的东西写进去
  assert.equal(Object.keys(info).includes('DATABASE_URL'), false);
});
