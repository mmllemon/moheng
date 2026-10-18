import assert from 'node:assert/strict';
import test from 'node:test';
import { asIsoDate, isIsoDateWithinBounds, monthIntersectsIsoDateBounds, normalizeIsoDateWithinBounds, parseIsoDate } from './date-picker-utils.js';

test('date picker parses only real ISO calendar dates', () => {
  assert.equal(asIsoDate(new Date(2024, 1, 29)), '2024-02-29');
  assert.ok(parseIsoDate('2024-02-29'));
  assert.equal(parseIsoDate('2025-02-29'), null);
  assert.equal(parseIsoDate('2026-13-01'), null);
  assert.equal(parseIsoDate('not-a-date'), null);
});

test('controlled values normalize to the nearest valid min/max boundary', () => {
  assert.equal(normalizeIsoDateWithinBounds('2026-01-10', '2026-02-01', '2026-03-31'), '2026-02-01');
  assert.equal(normalizeIsoDateWithinBounds('2026-04-10', '2026-02-01', '2026-03-31'), '2026-03-31');
  assert.equal(normalizeIsoDateWithinBounds('2026-02-14', '2026-02-01', '2026-03-31'), '2026-02-14');
  assert.equal(normalizeIsoDateWithinBounds('', '2026-02-01'), null);
});

test('disabled dates and contradictory bounds never become a keyboard focus target', () => {
  assert.equal(isIsoDateWithinBounds('2026-01-31', '2026-02-01', '2026-03-31'), false);
  assert.equal(isIsoDateWithinBounds('2026-02-01', '2026-02-01', '2026-03-31'), true);
  assert.equal(normalizeIsoDateWithinBounds('2026-02-14', '2026-03-31', '2026-02-01'), null);
  assert.equal(isIsoDateWithinBounds('2026-02-14', '2026-03-31', '2026-02-01'), false);
});

test('calendar navigation cannot move into a month with no enabled date', () => {
  assert.equal(monthIntersectsIsoDateBounds(2026, 1, '2026-02-01', '2026-02-28'), true);
  assert.equal(monthIntersectsIsoDateBounds(2026, 0, '2026-02-01', '2026-02-28'), false);
  assert.equal(monthIntersectsIsoDateBounds(2026, 2, '2026-02-01', '2026-02-28'), false);
  assert.equal(monthIntersectsIsoDateBounds(2026, 2, null, null), true);
  assert.equal(monthIntersectsIsoDateBounds(2026, 1, '2026-03-31', '2026-02-01'), false);
});
