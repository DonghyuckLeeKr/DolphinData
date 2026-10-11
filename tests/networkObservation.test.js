import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceNetworkObservation } from '../src/services/networkObservation.js';

const connected = (fingerprint) => ({ connected: true, fingerprint });

test('a transient network is not confirmed before the second consecutive sample', () => {
  const initial = advanceNetworkObservation(undefined, connected('router-a'));
  const disconnected = advanceNetworkObservation(initial, { connected: false });

  assert.equal(initial.confirmed, false);
  assert.deepEqual(disconnected, { fingerprint: '', count: 0, confirmed: false });
});

test('a stable connection is confirmed and a changed fingerprint restarts the check', () => {
  const first = advanceNetworkObservation(undefined, connected('router-a'));
  const confirmed = advanceNetworkObservation(first, connected('router-a'));
  const changed = advanceNetworkObservation(confirmed, connected('router-b'));

  assert.equal(confirmed.confirmed, true);
  assert.equal(changed.confirmed, false);
  assert.equal(advanceNetworkObservation(changed, connected('router-b')).confirmed, true);
});
