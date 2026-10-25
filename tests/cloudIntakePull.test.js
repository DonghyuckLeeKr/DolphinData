import test from 'node:test';
import assert from 'node:assert/strict';
import { cloudIntakeEndpoint, startCloudIntake } from '../automation/cloudIntake.mjs';

const TOKEN = 'c'.repeat(64);

// A fake cloud queue speaking the Worker's admin API.
function fakeCloud(items) {
  const queue = [...items];
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method || 'GET', auth: options.headers?.Authorization });
    const { pathname } = new URL(url);
    if (pathname === '/v1/admin/reports') {
      return new Response(JSON.stringify({ reports: queue.slice(0, 25), pending: queue.length }), { status: 200 });
    }
    const id = pathname.split('/').at(-1);
    const index = queue.findIndex(item => item.receiptId === id);
    if (index >= 0) queue.splice(index, 1);
    return new Response(null, { status: 204 });
  };
  return { queue, calls, fetchImpl };
}

const item = (receiptId, body = '{}') => ({ receiptId, receivedAt: '2026-10-25T00:00:00Z', body });

test('pulled reports are imported as untrusted and then removed from the cloud', async () => {
  const cloud = fakeCloud([item('11111111-1111-1111-1111-111111111111', 'A'), item('22222222-2222-2222-2222-222222222222', 'B')]);
  const imported = [];
  const controller = { importReport: async (raw, options) => { imported.push({ raw, options }); } };
  const intake = startCloudIntake(controller, { endpoint: 'https://intake.example', token: TOKEN, fetchImpl: cloud.fetchImpl, intervalMs: 60_000 });
  await intake.pull(); intake.close();
  assert.deepEqual(imported.map(i => i.raw), ['A', 'B']);
  assert.ok(imported.every(i => i.options === undefined), 'cloud reports must wait for owner triage');
  assert.equal(cloud.queue.length, 0);
  assert.ok(cloud.calls.every(call => call.auth === `Bearer ${TOKEN}`));
  assert.equal(intake.status.connected, true);
});

test('corrupt reports are dropped, but a full local store keeps them queued', async () => {
  const cloud = fakeCloud([item('33333333-3333-3333-3333-333333333333', 'bad'), item('44444444-4444-4444-4444-444444444444', 'later')]);
  const controller = {
    importReport: async raw => {
      if (raw === 'bad') throw new Error('지원하지 않거나 손상된 진단 리포트입니다.');
      throw new Error('보관 한도 200개에 도달했습니다.');
    }
  };
  const intake = startCloudIntake(controller, { endpoint: 'https://intake.example', token: TOKEN, fetchImpl: cloud.fetchImpl });
  await intake.pull(); intake.close();
  assert.deepEqual(cloud.queue.map(i => i.receiptId), ['44444444-4444-4444-4444-444444444444']);
  assert.equal(intake.status.connected, false);
  assert.match(intake.status.error, /보관 한도/);
});

test('a rejected token is reported without touching the queue', async () => {
  const intake = startCloudIntake({ importReport: async () => {} }, {
    endpoint: 'https://intake.example', token: TOKEN, fetchImpl: async () => new Response('{}', { status: 401 })
  });
  await intake.pull(); intake.close();
  assert.match(intake.status.error, /토큰/);
});

test('only a plain https origin is accepted as the cloud endpoint', () => {
  assert.equal(cloudIntakeEndpoint('https://dolphindata-intake.example.workers.dev/'), 'https://dolphindata-intake.example.workers.dev');
  for (const bad of ['http://intake.example', 'https://user:pw@intake.example', 'https://intake.example/v1/reports', 'https://intake.example?x=1']) {
    assert.throws(() => cloudIntakeEndpoint(bad), bad);
  }
});
