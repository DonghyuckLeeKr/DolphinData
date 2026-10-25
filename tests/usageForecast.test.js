import test from 'node:test';
import assert from 'node:assert/strict';
import { forecastUsage, getBillingWindow } from '../src/services/usageForecast.js';

const local = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('billing window clamps reset day 31 to short months', () => {
  const { start, end } = getBillingWindow(31, local(2026, 2, 15));
  assert.deepEqual([start.getMonth(), start.getDate()], [0, 31]);
  assert.deepEqual([end.getMonth(), end.getDate()], [1, 28]);
});

test('billing window starts on reset day itself', () => {
  const { start, end } = getBillingWindow(10, local(2026, 10, 10, 0));
  assert.deepEqual([start.getMonth(), start.getDate()], [9, 10]);
  assert.deepEqual([end.getMonth(), end.getDate()], [10, 10]);
});

test('fast pace projects a depletion date before the reset', () => {
  // 10 days into a 31-day period, 50 of 100 GB used -> 5 GB/day -> runs out 10 days later.
  const result = forecastUsage({ usedGB: 50, limitGB: 100, resetDay: 1, now: local(2026, 10, 11, 0) });
  assert.equal(result.status, 'over');
  assert.equal(result.depletionDate.getDate(), 21);
  assert.ok(Math.abs(result.dailyPaceGB - 5) < 1e-9);
});

test('slow pace stays safe and has no depletion date', () => {
  const result = forecastUsage({ usedGB: 10, limitGB: 100, resetDay: 1, now: local(2026, 10, 11, 0) });
  assert.equal(result.status, 'safe');
  assert.equal(result.depletionDate, null);
  assert.ok(result.projectedTotalGB < 40);
});

test("today's allowance spreads the remaining data over the days left including today", () => {
  const now = local(2026, 10, 25, 15);
  const result = forecastUsage({ usedGB: 60, limitGB: 100, resetDay: 1, now, dailyGB: { '2026-10-25': 1 } });
  // 41 GB were left this morning, 7 days remain including today.
  assert.equal(result.daysLeftIncludingToday, 7);
  assert.ok(Math.abs(result.todayBudgetGB - 41 / 7) < 1e-9);
  assert.ok(Math.abs(result.todayLeftGB - (41 / 7 - 1)) < 1e-9);
});

test('exhausted plans report today as the depletion date', () => {
  const result = forecastUsage({ usedGB: 120, limitGB: 100, resetDay: 1, now: local(2026, 10, 25) });
  assert.equal(result.status, 'exhausted');
  assert.equal(result.remainingGB, 0);
  assert.equal(result.depletionDate.getDate(), 25);
});

test('burn-down series ends at the real total even with a calibrated baseline', () => {
  const result = forecastUsage({
    usedGB: 20, limitGB: 100, resetDay: 1, now: local(2026, 10, 3),
    dailyGB: { '2026-10-01': 2, '2026-10-02': 3, '2026-10-03': 1, '2026-09-30': 50 }
  });
  assert.deepEqual(result.series.map(point => point.cumulativeGB), [16, 19, 20]);
});
