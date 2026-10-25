import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomationController } from '../automation/controller.mjs';
import { DailyBatchRunner, dailyPlan, seoulDay } from '../automation/daily.mjs';
import { createAdminServer } from '../automation/server.mjs';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

function report(description = '화면 개선 확인', symptom = 'other', empty = false) {
  const recorder = createDiagnosticRecorder(); recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id });
  if (!empty) recorder.observe({ connected: false }); recorder.stop(); return recorder.export({ description, symptom });
}
async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-daily-test-'));
  t.after(async () => { assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-daily-test-'))); await rm(directory, { recursive: true, force: true }); });
  const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
  controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true });
  const generated = [];
  controller.generate = async record => { generated.push(record.id); record.status = 'review-ready'; record.candidateSha = 'a'.repeat(40); await controller.save(record); };
  let now = new Date('2026-10-11T12:00:00Z');
  const daily = new DailyBatchRunner(controller, { now: () => now }); await daily.init();
  await daily.configure({ enabled: true, time: '21:00', timeZone: 'Asia/Seoul' });
  const settle = async () => { while (controller.busy) await new Promise(resolve => setTimeout(resolve, 5)); };
  return { controller, daily, generated, directory, settle, setNow: value => { now = new Date(value); } };
}

test('daily identity uses the Korean date across UTC midnight boundaries', () => {
  assert.equal(seoulDay(new Date('2026-10-11T14:59:59Z')), '2026-10-11');
  assert.equal(seoulDay(new Date('2026-10-11T15:00:00Z')), '2026-10-12');
});

test('preview never runs AI; concurrent triggers and restart run only once per Korean day', async t => {
  const { controller, daily, generated, directory, settle } = await setup(t);
  const one = await controller.importReport(report(), { trusted: true }); const two = await controller.importReport(report(), { trusted: true });
  const preview = await daily.run({ previewOnly: true }); assert.deepEqual(preview.ids, [one.id, two.id]); assert.equal(generated.length, 0); assert.equal(daily.history.length, 0);
  const results = await Promise.all([daily.run(), daily.run(), daily.run()]); await settle();
  assert.deepEqual(results.map(r => r.state), ['started', 'already-checked', 'already-checked']);
  assert.equal(generated.length, 1); assert.equal(controller.list().filter(r => r.kind === 'batch').length, 1);
  const job = controller.get(results[0].jobId); assert.deepEqual(job.reportIds, [one.id, two.id]); assert.equal(job.dailyRunDate, '2026-10-11');
  const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
  const resumed = new DailyBatchRunner(reloaded, { now: () => new Date('2026-10-11T13:00:00Z') }); await resumed.init();
  assert.equal((await resumed.run()).state, 'already-checked'); assert.equal(resumed.status().last.jobStatus, 'review-ready');
});

test('oldest ten are grouped; pending approval defers newer receipts until the next day', async t => {
  const { controller, daily, generated, settle, setNow } = await setup(t);
  const ids = [];
  for (let i = 0; i < 12; i++) { const r = await controller.importReport(report(`일반 요청 ${i}`), { trusted: true }); controller.get(r.id).createdAt = new Date(2026, 9, 1, 0, i).toISOString(); ids.push(r.id); }
  const first = await daily.run(); await settle(); assert.equal(first.state, 'started'); assert.equal(first.remaining, 2);
  assert.deepEqual(controller.get(first.jobId).reportIds, ids.slice(0, 10));
  setNow('2026-10-12T12:00:00Z'); const deferred = await daily.run(); assert.equal(deferred.state, 'deferred'); assert.equal(generated.length, 1);
  const job = controller.get(first.jobId); job.status = 'released'; await controller.save(job);
  setNow('2026-10-13T12:00:00Z'); const next = await daily.run(); await settle(); assert.equal(next.state, 'started');
  assert.deepEqual(controller.get(next.jobId).reportIds, ids.slice(10)); assert.equal(generated.length, 2);
});

test('failed and interrupted receipts are not retried; excluded receipts persist; one fresh receipt runs alone', async t => {
  const { controller, daily, directory, generated, settle } = await setup(t);
  const excluded = await controller.importReport(report(), { trusted: true }); await controller.setAutomatic(excluded.id, false, 'test');
  for (const status of ['failed', 'interrupted']) { const r = await controller.importReport(report(), { trusted: true }); controller.get(r.id).status = status; await controller.save(controller.get(r.id)); }
  const fresh = await controller.importReport(report(), { trusted: true });
  assert.deepEqual(dailyPlan(controller).ids, [fresh.id]); assert.equal(dailyPlan(controller).excluded, 1);
  const started = await daily.run(); await settle(); assert.equal(started.jobId, fresh.id); assert.deepEqual(generated, [fresh.id]);
  assert.equal(controller.get(excluded.id).status, 'received');
  const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init(); assert.equal(reloaded.get(excluded.id).autoProcessExcluded, true);
  await assert.rejects(controller.setAutomatic(fresh.id, 'true', 'test'));
});

test('public receipts wait for owner triage before the daily run sends them to AI', async t => {
  const { controller, daily, generated, directory, settle, setNow } = await setup(t);
  const untrusted = await controller.importReport(report('외부에서 접수된 요청'));
  assert.equal(untrusted.triagePending, true); assert.equal(untrusted.autoProcessExcluded, true); assert.equal(untrusted.canRequestFix, true);
  assert.deepEqual(dailyPlan(controller).ids, []); assert.equal(dailyPlan(controller).awaitingTriage, 1); assert.equal(dailyPlan(controller).excluded, 0);
  assert.equal((await daily.run()).state, 'empty'); assert.equal(generated.length, 0);
  const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
  assert.equal(reloaded.get(untrusted.id).triagePending, true);
  const included = await controller.setAutomatic(untrusted.id, true, 'test');
  assert.equal(included.triagePending, undefined); assert.equal(included.autoProcessExcluded, false);
  setNow('2026-10-12T12:00:00Z'); assert.deepEqual(dailyPlan(controller).ids, [untrusted.id]);
  const started = await daily.run(); await settle(); assert.equal(started.jobId, untrusted.id); assert.deepEqual(generated, [untrusted.id]);
});

test('empty days skip model readiness and AI; missing evidence is marked without blocking a valid request', async t => {
  const { controller, daily, generated, setNow, settle } = await setup(t);
  controller.readiness = async () => { throw new Error('로그인 미완료'); };
  assert.equal((await daily.run()).state, 'empty'); assert.equal(generated.length, 0);
  setNow('2026-10-12T12:00:00Z'); controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true });
  const bad = await controller.importReport(report('재연결 문제', 'same-router-reconnect'), { trusted: true });
  const good = await controller.importReport(report(), { trusted: true }); const result = await daily.run(); await settle();
  assert.equal(result.jobId, good.id); assert.equal(result.insufficient.length, 1); assert.equal(controller.get(bad.id).status, 'insufficient-evidence');
});

test('persisted reservation after a crash never repeats AI, even before a job existed', async t => {
  const { directory, controller, generated } = await setup(t); await controller.importReport(report(), { trusted: true });
  await writeFile(path.join(directory, 'daily-runs.json'), JSON.stringify({ runs: [{ day: '2026-10-11', state: 'preparing', ids: [] }] }));
  const daily = new DailyBatchRunner(controller, { now: () => new Date('2026-10-11T12:00:00Z') }); await daily.init();
  assert.equal(daily.status().last.state, 'interrupted'); assert.equal((await daily.run()).state, 'already-checked'); assert.equal(generated.length, 0);
});

test('disabled and failed readiness do not start AI; failed daily trigger is not automatically retried', async t => {
  const { daily, controller, generated } = await setup(t); await controller.importReport(report(), { trusted: true });
  await daily.configure({ enabled: false, time: '21:00', timeZone: 'Asia/Seoul' }); assert.equal((await daily.run()).state, 'disabled');
  await daily.configure({ enabled: true, time: '21:00', timeZone: 'Asia/Seoul' });
  controller.readiness = async () => ({ codex: false }); assert.equal((await daily.run()).state, 'failed');
  assert.equal((await daily.run()).state, 'already-checked'); assert.equal(generated.length, 0);
  await assert.rejects(daily.configure({ enabled: true, time: '25:00', timeZone: 'Asia/Seoul' }));
});

test('daily API requires local admin authentication, boolean preview and an online Discord bot', async t => {
  const { controller, daily, generated } = await setup(t);
  const admin = await createAdminServer(controller, { port: 0, token: 'test-key', daily });
  t.after(() => new Promise(resolve => admin.server.close(resolve))); const origin = new URL(admin.url).origin;
  const post = (body, auth = true) => fetch(`${origin}/api/daily-run`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer test-key' } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ previewOnly: true }, false)).status, 401);
  assert.equal((await post({ previewOnly: true })).status, 200);
  assert.equal((await post({ previewOnly: 'false' })).status, 400); assert.equal((await post({})).status, 400);
  assert.equal(generated.length, 0); assert.equal(daily.history.length, 0);
});
