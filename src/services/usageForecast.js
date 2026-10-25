// Turns the current billing period's usage into a forecast: depletion date, today's allowance and a burn-down series.

import { getTodayKey } from './storageService.js';

const DAY_MS = 86400000;

const startOfDay = date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const resetDateIn = (year, monthIndex, resetDay) => {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(resetDay, lastDay));
};

export const getBillingWindow = (resetDay = 1, now = new Date()) => {
  const validResetDay = Math.min(31, Math.max(1, parseInt(resetDay, 10) || 1));
  const today = startOfDay(now);
  let start = resetDateIn(today.getFullYear(), today.getMonth(), validResetDay);
  if (today < start) start = resetDateIn(today.getFullYear(), today.getMonth() - 1, validResetDay);
  const end = resetDateIn(start.getFullYear(), start.getMonth() + 1, validResetDay);
  return { start, end };
};

export const forecastUsage = ({ usedGB = 0, limitGB = 0, resetDay = 1, dailyGB = {}, now = new Date() } = {}) => {
  const used = Math.max(0, Number(usedGB) || 0);
  const limit = Math.max(0, Number(limitGB) || 0);
  const { start, end } = getBillingWindow(resetDay, now);

  const totalDays = Math.round((end - start) / DAY_MS);
  // Never divide by less than one day so the first hours of a period do not explode the pace.
  const elapsedDays = Math.max(1, (now - start) / DAY_MS);
  const remainingDays = Math.max(0, (end - now) / DAY_MS);
  const daysLeftIncludingToday = Math.max(1, Math.round((end - startOfDay(now)) / DAY_MS));

  const dailyPaceGB = used / elapsedDays;
  const projectedTotalGB = used + dailyPaceGB * remainingDays;
  const remainingGB = Math.max(0, limit - used);

  const todayUsedGB = Math.max(0, Number(dailyGB[getTodayKey(now)]) || 0);
  const todayBudgetGB = limit > 0 ? (remainingGB + todayUsedGB) / daysLeftIncludingToday : 0;
  const todayLeftGB = todayBudgetGB - todayUsedGB;

  let depletionDate = null;
  if (limit > 0 && used >= limit) depletionDate = startOfDay(now);
  else if (limit > 0 && dailyPaceGB > 0 && projectedTotalGB > limit) {
    depletionDate = new Date(now.getTime() + (remainingGB / dailyPaceGB) * DAY_MS);
  }

  let status = 'safe';
  if (limit > 0 && used >= limit) status = 'exhausted';
  else if (limit > 0 && projectedTotalGB > limit) status = 'over';
  else if (limit > 0 && projectedTotalGB > limit * 0.9) status = 'tight';

  // Cumulative series from period start to today. Calibrated baselines have no daily entry,
  // so the gap between history and the real total is attributed to the first day.
  const series = [];
  let historySum = 0;
  const elapsedWholeDays = Math.round((startOfDay(now) - start) / DAY_MS);
  for (let index = 0; index <= elapsedWholeDays; index++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    historySum += Math.max(0, Number(dailyGB[getTodayKey(day)]) || 0);
    series.push({ dayIndex: index, cumulativeGB: historySum });
  }
  const offset = Math.max(0, used - historySum);
  series.forEach(point => { point.cumulativeGB += offset; });

  return {
    start, end, totalDays, elapsedDays, remainingDays, daysLeftIncludingToday,
    usedGB: used, limitGB: limit, remainingGB, percentUsed: limit > 0 ? Math.min(100, (used / limit) * 100) : 0,
    dailyPaceGB, projectedTotalGB, depletionDate, status,
    todayUsedGB, todayBudgetGB, todayLeftGB, series
  };
};
