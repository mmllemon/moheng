import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateEffectiveContractAmount, centsToMoney, moneyToCents, transportSafeCents } from './contract-amount-math.js';
import { nonNegativeMoney, positiveMoney } from './validation.js';

/**
 * 金额契约：JSON 里金额是 number，所以“能精确表示的 cents 上限”是 2^53 - 1，
 * 不是 PostgreSQL DECIMAL(18,2) 的 10^18 - 1。
 *
 * 实测（2026-11-04，node 24）：DECIMAL 上限 9999999999999999.99 元经
 * Number(centsToMoney(...)) 变成 10000000000000000，直接丢 1 分；而
 * `9007199254740993.01` 这种输入能通过两位小数校验，落库值变成
 * 900719925474099400 分（原值 900719925474099301 分），静默丢分。
 *
 * 这些用例先按“必须在边界处拒绝”的期望写，实现前应当是红的。
 */
const MAX_SAFE_CENTS = 9007199254740991n; // Number.MAX_SAFE_INTEGER

test('transportSafeCents 拒绝超出 JSON 安全整数范围的金额', () => {
  // 恰好在上限内：90071992547409.91 元 = 9007199254740991 分
  assert.equal(transportSafeCents('90071992547409.91'), MAX_SAFE_CENTS);
  // 差一分就越界
  assert.throws(() => transportSafeCents('90071992547409.92'), /MONEY_VALUE_EXCEEDS_TRANSPORT_SAFE_RANGE/);
  assert.throws(() => transportSafeCents('9999999999999999.99'), /MONEY_VALUE_EXCEEDS_TRANSPORT_SAFE_RANGE/);
  // 解析函数本身仍能精确读出超限值（读库里已有的数据不因此报错）
  assert.equal(moneyToCents('9999999999999999.99'), 999999999999999999n);
});

test('有效合同额不会算出一个 JSON 无法精确承载的数值', () => {
  // 相加后越界
  assert.throws(
    () => calculateEffectiveContractAmount('90071992547409.91', [{ direction: 'INCREASE', amount: '0.01' }]),
    { message: 'CONTRACT_AMOUNT_EXCEEDS_MAX' },
  );
  // 入参本身越界，在解析阶段就拒
  assert.throws(
    () => calculateEffectiveContractAmount('90071992547409.92', []),
    /MONEY_VALUE_EXCEEDS_TRANSPORT_SAFE_RANGE/,
  );
  assert.equal(calculateEffectiveContractAmount('90071992547409.91', []), '90071992547409.91');
});

test('金额入参 schema 拒绝超出安全整数范围的数值', () => {
  assert.equal(nonNegativeMoney.safeParse(90071992547409.91).success, true);
  assert.equal(nonNegativeMoney.safeParse(90071992547409.92).success, false);
  assert.equal(positiveMoney.safeParse(9999999999999999.99).success, false);
});

test('安全范围内的一分钱可以精确往返 JSON', () => {
  const cents = moneyToCents('90071992547409.91');
  const transported = JSON.parse(JSON.stringify({ amount: Number(centsToMoney(cents)) })).amount;
  assert.equal(moneyToCents(transported.toFixed(2)), cents);
});
