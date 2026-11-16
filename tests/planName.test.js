import test from 'node:test';
import assert from 'node:assert/strict';
import { describePlan, parsePlanName } from '../src/utils/planName.js';

test('a bare "11GB+" MVNO plan gets the usual daily top-up and 3Mbps, marked as guessed', () => {
  const plan = parsePlanName('[A모바일]A 스페셜 11GB+');
  assert.equal(plan.carrierName, 'A모바일');
  assert.equal(plan.planName, 'A 스페셜 11GB+');
  assert.equal(plan.monthlyLimitGB, 11);
  assert.equal(plan.dailyBonusGB, 2);
  assert.equal(plan.afterLimit, 'throttled');
  assert.equal(plan.throttleMbps, 3);
  assert.deepEqual(plan.guessed.sort(), ['dailyBonusGB', 'throttleMbps']);
});

test('values written in the name are taken as stated', () => {
  const plan = parsePlanName('월 11GB+일2GB+3Mbps');
  assert.deepEqual([plan.monthlyLimitGB, plan.dailyBonusGB, plan.throttleMbps, plan.afterLimit], [11, 2, 3, 'throttled']);
  assert.deepEqual(plan.guessed, []);

  const big = parsePlanName('(모요)데이터 100GB+ 5Mbps');
  assert.deepEqual([big.carrierName, big.monthlyLimitGB, big.throttleMbps, big.dailyBonusGB], ['모요', 100, 5, undefined]);

  const kbps = parsePlanName('LTE 3GB+400Kbps');
  assert.equal(kbps.throttleMbps, 0.4);
});

test('other "+" plans guess only the speed, scaled to the plan size', () => {
  assert.deepEqual([parsePlanName('LTE 15GB+/100분').throttleMbps, parsePlanName('LTE 15GB+/100분').dailyBonusGB], [3, undefined]);
  assert.equal(parsePlanName('7GB+').throttleMbps, 1);
  assert.equal(parsePlanName('150GB+').throttleMbps, 5);
});

test('call or text "unlimited" does not make the data unlimited', () => {
  const plan = parsePlanName('LTE 6GB 통화 무제한');
  assert.equal(plan.monthlyLimitGB, 6);
  assert.equal(plan.afterLimit, 'blocked');
  assert.equal(parsePlanName('데이터 무제한 5Mbps').afterLimit, 'throttled');
});

test('MB amounts and names without numbers', () => {
  assert.equal(parsePlanName('알뜰 500MB').monthlyLimitGB, 0.49);
  const plain = parsePlanName('회사 에그');
  assert.equal(plain.monthlyLimitGB, undefined);
  assert.equal(plain.afterLimit, undefined);
});

test('plan structure is described in one line', () => {
  assert.equal(describePlan({ monthlyLimitGB: 11, dailyBonusGB: 2, afterLimit: 'throttled', throttleMbps: 3 }), '월 11GB + 매일 2GB · 이후 3Mbps 무제한');
  assert.equal(describePlan({ monthlyLimitGB: 100, afterLimit: 'blocked' }), '월 100GB · 다 쓰면 차단·추가 요금');
});
