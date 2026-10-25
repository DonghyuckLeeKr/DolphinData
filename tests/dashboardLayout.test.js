import test from 'node:test';
import assert from 'node:assert/strict';
import { balanceDashboardColumns, chooseDashboardColumns } from '../src/utils/dashboardLayout.js';

test('on a metered network the tall process list sits alone opposite the live cards', () => {
  assert.deepEqual(balanceDashboardColumns(['traffic', 'speed', 'ping', 'processes']), [
    ['traffic', 'speed', 'ping'],
    ['processes']
  ]);
});

test('with the network prompt shown, ping moves over to keep the columns even', () => {
  assert.deepEqual(balanceDashboardColumns(['network-state', 'traffic', 'speed', 'ping', 'processes']), [
    ['network-state', 'traffic', 'speed'],
    ['ping', 'processes']
  ]);
});

test('hidden cards rebalance and a single card uses a single column', () => {
  assert.deepEqual(balanceDashboardColumns(['traffic', 'speed', 'ping']), [['traffic'], ['speed', 'ping']]);
  assert.deepEqual(balanceDashboardColumns(['speed']), [['speed']]);
  assert.deepEqual(balanceDashboardColumns([]), []);
});

test('measured heights override the estimates', () => {
  // In the browser preview the process card is short, so ping and speed join it on the right.
  const heights = { 'network-state': 250, traffic: 284, speed: 213, ping: 169, processes: 267 };
  const columns = balanceDashboardColumns(['network-state', 'traffic', 'speed', 'ping', 'processes'], heights);
  const totals = columns.map(ids => ids.reduce((sum, id) => sum + heights[id], 0));
  assert.ok(Math.abs(totals[0] - totals[1]) <= 120, JSON.stringify({ columns, totals }));
});

test('small height changes keep the current split so cards do not jump', () => {
  const ids = ['traffic', 'speed', 'ping', 'processes'];
  const previous = [['traffic', 'speed', 'ping'], ['processes']];
  assert.deepEqual(chooseDashboardColumns(ids, { traffic: 285, speed: 215, ping: 170, processes: 640 }, previous), previous);
  // The process list collapsed to a short notice: rebalancing is now clearly better.
  const next = chooseDashboardColumns(ids, { traffic: 285, speed: 215, ping: 170, processes: 260 }, previous);
  assert.notDeepEqual(next, previous);
  // A different set of cards always takes the fresh split.
  assert.deepEqual(chooseDashboardColumns(['speed'], {}, previous), [['speed']]);
});
