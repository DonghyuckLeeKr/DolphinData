import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAndNotifyThresholds } from '../src/services/notificationService.js';

const collector = () => {
  const sent = [];
  return { sent, notify: title => sent.push(title) };
};

test('starting above 95% sends one alert instead of counting down 95 -> 90 -> 80', () => {
  const { sent, notify } = collector();
  for (let tick = 0; tick < 3; tick++) checkAndNotifyThresholds(96, 100, '테스트', 'cascade', {}, notify);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /95%/);
});

test('each newly crossed level alerts once as usage climbs', () => {
  const { sent, notify } = collector();
  for (const used of [79, 81, 85, 91, 93, 96, 99]) checkAndNotifyThresholds(used, 100, '테스트', 'climb', {}, notify);
  assert.deepEqual(sent.map(title => title.match(/\d+%/)[0]), ['80%', '90%', '95%']);
});

test('disabled alert levels are skipped and fall back to the highest enabled level', () => {
  const { sent, notify } = collector();
  const alerts = { t80: true, t90: true, t95: false };
  checkAndNotifyThresholds(96, 100, '테스트', 'settings', alerts, notify);
  checkAndNotifyThresholds(97, 100, '테스트', 'settings', alerts, notify);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /90%/);

  const off = collector();
  checkAndNotifyThresholds(99, 100, '테스트', 'all-off', { t80: false, t90: false, t95: false }, off.notify);
  assert.equal(off.sent.length, 0);
});

test('dropping below 75% re-arms the alerts', () => {
  const { sent, notify } = collector();
  checkAndNotifyThresholds(85, 100, '테스트', 'rearm', {}, notify);
  checkAndNotifyThresholds(10, 100, '테스트', 'rearm', {}, notify);
  checkAndNotifyThresholds(85, 100, '테스트', 'rearm', {}, notify);
  assert.equal(sent.length, 2);
});
