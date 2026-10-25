import test from 'node:test';
import assert from 'node:assert/strict';
import { quantizeLevel, trayGaugeKey } from '../src/services/trayGauge.js';

test('tray level snaps to 4% steps and never shows empty while data remains', () => {
  assert.equal(quantizeLevel(1), 1);
  assert.equal(quantizeLevel(0.5), 0.52);
  assert.equal(quantizeLevel(0.001), 0.04);
  assert.equal(quantizeLevel(0), 0);
  assert.equal(quantizeLevel(-1), 0);
  assert.equal(quantizeLevel(Number.NaN), 0);
});

test('tray key changes only when the drawn level or status changes', () => {
  assert.equal(trayGaugeKey({ remainingRatio: 0.61, status: 'safe' }), trayGaugeKey({ remainingRatio: 0.605, status: 'safe' }));
  assert.notEqual(trayGaugeKey({ remainingRatio: 0.61, status: 'safe' }), trayGaugeKey({ remainingRatio: 0.55, status: 'safe' }));
  assert.notEqual(trayGaugeKey({ remainingRatio: 0.61, status: 'safe' }), trayGaugeKey({ remainingRatio: 0.61, status: 'tight' }));
});
