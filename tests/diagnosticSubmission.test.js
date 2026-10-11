import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticSession } from '../src/services/diagnosticSubmission.js';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

const config = { profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id };
const receipt = report => ({ reportId: report.reportId, receiptId: '87654321-1234-1234-1234-123456789abc', receivedAt: '2026-10-11T00:00:00.000Z' });
const storage = () => { const values = new Map(); return { getItem: k => values.get(k), setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
const setup = extra => { const recorder = createDiagnosticRecorder(); const options = { recorder, storage: storage(), environment: async () => ({}), version: async () => '1.3.1', platform: () => 'windows', ...extra }; return { recorder, options, session: createDiagnosticSession(options) }; };

test('one click stops, anonymizes and submits; double clicks cannot send twice', async () => {
  let complete; let sends = 0;
  const { recorder, session } = setup({ send: report => { sends++; return new Promise(resolve => { complete = () => resolve(receipt(report)); }); } });
  await session.begin(config); session.edit({ description: 'test person@example.com' }); recorder.observe({ connected: false });
  const pending = session.submit(); await session.submit();
  assert.equal(recorder.status().recording, false); assert.equal(session.getSnapshot().phase, 'submitting'); assert.equal(sends, 1);
  assert.ok(!session.getSnapshot().report.description.includes('person@example.com'));
  session.edit({ description: 'must not alter submitted body' });
  complete(); await pending; assert.equal(session.getSnapshot().phase, 'submitted');
  await session.submit(); assert.equal(sends, 1);
});
test('failed request survives restart and retries the exact same report ID and body', async () => {
  const bodies = []; let failed = true;
  const { recorder, session, options } = setup({ send: async report => { bodies.push(JSON.stringify(report)); if (failed) throw new Error('offline'); return receipt(report); } });
  await session.begin(config); recorder.observe({ connected: false }); await session.submit();
  assert.equal(session.getSnapshot().error, 'offline'); assert.equal(session.getSnapshot().phase, 'stopped');
  const reloaded = createDiagnosticSession(options); failed = false; await reloaded.submit();
  assert.equal(bodies[0], bodies[1]); assert.equal(reloaded.getSnapshot().phase, 'submitted');
  const confirmed = createDiagnosticSession(options); assert.equal(confirmed.getSnapshot().receipt.receiptId, receipt({}).receiptId);
});
test('wrong receipt is never shown as successful; draft edits survive subscriptions', async () => {
  const { recorder, session } = setup({ send: async () => receipt({ reportId: 'wrong' }) });
  let changed = 0; const unsubscribe = session.subscribe(() => changed++);
  session.edit({ symptom: 'startup', description: 'kept when settings closes' }); unsubscribe();
  await session.begin(config); recorder.observe({ connected: false }); await session.submit();
  assert.equal(session.getSnapshot().description, 'kept when settings closes'); assert.equal(changed, 1);
  assert.equal(session.getSnapshot().receipt, null); assert.equal(session.getSnapshot().phase, 'stopped');
});
test('empty recording is not submitted or automatically stopped', async () => {
  const { recorder, session } = setup({ send: () => { throw new Error('must not send'); } });
  await session.begin(config); await session.submit(); assert.equal(recorder.status().recording, true);
  assert.ok(session.getSnapshot().error.includes('아직 기록된'));
});
