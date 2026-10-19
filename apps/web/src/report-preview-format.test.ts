import test from 'node:test';
import assert from 'node:assert/strict';
import { roundFixedDecimal, formatIsoDateWithExcelPattern } from './report-preview-format.js';

test('rounds custom decimal formats beyond two places without negative BigInt exponents', () => {
  assert.equal(roundFixedDecimal('1.23456', 3), '1.235');
  assert.equal(roundFixedDecimal('1.23999', 2), '1.24');
  assert.equal(roundFixedDecimal('1.2345', 4), '1.2345');
});

test('carries rounding through the whole-number boundary and preserves the sign', () => {
  assert.equal(roundFixedDecimal('9.999', 2), '10.00');
  assert.equal(roundFixedDecimal('-1.999', 2), '-2.00');
  assert.equal(roundFixedDecimal('-1.5', 0), '-2');
});

test('pads missing decimal digits and supports integer formats', () => {
  assert.equal(roundFixedDecimal('12', 3), '12.000');
  assert.equal(roundFixedDecimal('12.345', 0), '12');
  assert.equal(roundFixedDecimal('0.005', 2), '0.01');
});

test('rejects invalid inputs and unsupported decimal precision safely', () => {
  assert.equal(roundFixedDecimal('not-a-number', 2), null);
  assert.equal(roundFixedDecimal('1.25', -1), null);
  assert.equal(roundFixedDecimal('1.25', 81), null);
});


test('formats ISO dates using custom numeric Excel date patterns', () => {
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'yyyy-mm-dd'), '2026-01-09');
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'dd/mm/yyyy'), '09/01/2026');
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'yyyy"年"m"月"d"日"'), '2026年1月9日');
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'yy-mm'), '26-01');
});

test('falls back for invalid dates and locale-dependent/time patterns', () => {
  assert.equal(formatIsoDateWithExcelPattern('2026-02-30', 'yyyy-mm-dd'), null);
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'dd-mmm-yyyy'), null);
  assert.equal(formatIsoDateWithExcelPattern('2026-01-09', 'yyyy-mm-dd hh:mm'), null);
});
