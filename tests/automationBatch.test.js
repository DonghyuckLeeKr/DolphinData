import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomationController } from '../automation/controller.mjs';
import { createAdminServer } from '../automation/server.mjs';
import { buildBatchFixPrompt } from '../automation/fixRequest.mjs';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

function report(description = '화면 개선 요청') {
  const recorder = createDiagnosticRecorder(); recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id });
  recorder.observe({ connected: false }); recorder.stop(); return recorder.export({ description, symptom: 'other' });
}

test('batch prompt includes every receipt privately and calls out unresolved requests', () => {
  const prompt = buildBatchFixPrompt([{ id: 'receipt-one', report: report('첫 화면 me@example.com') }, { id: 'receipt-two', report: report('둘째 화면 192.168.1.1') }]);
  for (const text of ['receipt-one', 'receipt-two', '첫 화면', '둘째 화면', 'what remains unresolved', 'untrusted data']) assert.ok(prompt.includes(text));
  assert.ok(!prompt.includes('me@example.com')); assert.ok(!prompt.includes('192.168.1.1'));
});

test('selected receipts persist as one job, prevent duplicate processing and exclude later arrivals', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-batch-test-'));
  try {
    const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
    controller.readiness = async () => ({ codex: true, previewWorkflow: true });
    let finish; const gate = new Promise(resolve => { finish = resolve; });
    controller.generate = async record => { await gate; record.status = 'insufficient-evidence'; await controller.save(record); };
    const one = await controller.importReport(report('첫 요청')); const two = await controller.importReport(report('둘째 요청'));
    for (const ids of [[one.id], [one.id, one.id], [one.id, 'missing'], Array(11).fill(one.id)]) await assert.rejects(controller.startBatch(ids, 'test'));
    assert.equal(controller.list().length, 2); assert.equal(controller.busy, false);
    const batch = await controller.startBatch([one.id, two.id], 'test'); assert.equal(batch.kind, 'batch'); assert.equal(batch.reports.length, 2);
    assert.deepEqual(batch.reportIds, [one.id, two.id]);
    await assert.rejects(controller.startBatch([one.id, two.id], 'test'));
    await assert.rejects(controller.startFix(one.id, 'test'));
    const later = await controller.importReport(report('다음 처리 대상')); assert.equal(later.canRequestFix, true);
    assert.ok(!controller.get(batch.id).reportIds.includes(later.id));
    const interrupted = new AutomationController({ directory, repositoryRoot: process.cwd() }); await interrupted.init();
    assert.equal(interrupted.get(batch.id).status, 'interrupted');
    assert.equal(interrupted.view(interrupted.get(one.id)).batchId, batch.id);
    assert.equal(interrupted.view(interrupted.get(one.id)).canRequestFix, false);
    finish(); await new Promise(resolve => setImmediate(resolve));
    while (controller.busy) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(controller.view(controller.get(batch.id)).canRequestFix, true);
    await assert.rejects(controller.startBatch([one.id, later.id], 'test'), /이미 처리/);
    const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
    assert.equal(reloaded.list().filter(r => r.kind === 'batch').length, 1);
    assert.equal(reloaded.view(reloaded.get(later.id)).canRequestFix, true);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-batch-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});

test('batch HTTP actions require administrator authentication and a valid selection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-batch-api-'));
  const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
  const admin = await createAdminServer(controller, { port: 0, token: 'test-key' }); const origin = new URL(admin.url).origin;
  try {
    const input = { method: 'POST', body: JSON.stringify({ ids: [] }), headers: { 'Content-Type': 'application/json' } };
    assert.equal((await fetch(`${origin}/api/batches`, input)).status, 401);
    assert.equal((await fetch(`${origin}/api/batches`, { ...input, headers: { ...input.headers, Authorization: 'Bearer test-key', Origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await fetch(`${origin}/api/batches`, { ...input, headers: { ...input.headers, Authorization: 'Bearer test-key' } })).status, 400);
    assert.equal(controller.list().length, 0);
  } finally { await new Promise(resolve => admin.server.close(resolve)); assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-batch-api-'))); await rm(directory, { recursive: true, force: true }); }
});

test('a closed batch cannot be approved and returning it to the queue preserves history and releases its members', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-batch-closed-'));
  try {
    const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
    controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true });
    controller.generate = async () => {};
    const one = await controller.importReport(report()); const two = await controller.importReport(report());
    const batch = await controller.startBatch([one.id, two.id], 'test'); await new Promise(resolve => setImmediate(resolve));
    const record = controller.get(batch.id); record.status = 'review-ready'; record.candidateSha = 'a'.repeat(40); record.patchDigest = 'b'.repeat(64);
    record.previewRunId = 42; record.previewTitle = 'preview'; record.previewConclusion = 'success'; record.prNumber = 5; record.prUrl = 'https://github.com/DonghyuckLeeKr/DolphinData/pull/5'; record.workspace = 'private-path';
    controller.api = async endpoint => endpoint.endsWith('/actions/runs/42') ? { conclusion: 'success', display_title: 'preview', head_sha: record.candidateSha } : { state: 'closed', merged_at: null };
    await assert.rejects(controller.approveCode(record.id, { sha: record.candidateSha, patchDigest: record.patchDigest, actor: 'test' }), /닫힌 수정안/);
    record.status = 'review-ready'; await controller.refresh(record.id); assert.equal(record.status, 'candidate-closed');
    await controller.returnToQueue(record.id, 'test'); assert.equal(record.status, 'retired');
    assert.equal(record.candidateHistory[0].candidateSha, 'a'.repeat(40)); assert.equal(controller.view(record).candidateHistory[0].workspace, undefined);
    assert.ok(controller.view(controller.get(one.id)).canRequestFix); assert.ok(controller.view(controller.get(two.id)).canRequestFix);
    const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
    assert.ok(reloaded.view(reloaded.get(one.id)).canRequestFix); assert.equal(reloaded.get(record.id).candidateHistory.length, 1);
  } finally { assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-batch-closed-'))); await rm(directory, { recursive: true, force: true }); }
});

test('explicit closed batch retry retains member and daily history while archiving the previous candidate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-batch-retry-'));
  try {
    const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
    controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true }); controller.generate = async () => {};
    const one = await controller.importReport(report()); const two = await controller.importReport(report());
    const batch = await controller.startBatch([one.id, two.id], 'test', { dailyRunDate: '2026-10-11' });
    while (controller.busy) await new Promise(resolve => setTimeout(resolve, 5));
    const record = controller.get(batch.id); record.status = 'candidate-closed'; record.candidateSha = 'a'.repeat(40); record.prNumber = 6; record.prUrl = 'https://github.com/DonghyuckLeeKr/DolphinData/pull/6'; record.previewConclusion = 'failure'; await controller.save(record);
    controller.api = async () => ({ state: 'open', merged_at: null });
    await assert.rejects(controller.returnToQueue(record.id, 'test', { keepBatch: true })); assert.equal(record.candidateSha, 'a'.repeat(40));
    controller.api = async () => ({ state: 'closed', merged_at: '2026-10-11' });
    await assert.rejects(controller.returnToQueue(record.id, 'test', { keepBatch: true }));
    controller.api = async () => ({ state: 'closed', merged_at: null });
    await controller.returnToQueue(record.id, 'test', { keepBatch: true });
    assert.equal(record.status, 'received'); assert.equal(record.dailyRunDate, '2026-10-11'); assert.equal(record.candidateSha, undefined);
    assert.equal(record.candidateHistory[0].candidateSha, 'a'.repeat(40));
    assert.equal(controller.view(controller.get(one.id)).batchId, batch.id); assert.equal(controller.view(controller.get(one.id)).canRequestFix, false);
    await controller.startFix(batch.id, 'test'); assert.equal(record.attempts, 2);
    while (controller.busy) await new Promise(resolve => setTimeout(resolve, 5));
    assert.deepEqual(record.reportIds, [one.id, two.id]);
    const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
    assert.equal(reloaded.view(reloaded.get(one.id)).batchId, batch.id); assert.equal(reloaded.get(batch.id).dailyRunDate, '2026-10-11');
    await assert.rejects(controller.returnToQueue(one.id, 'test', { keepBatch: true }));
  } finally { assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-batch-retry-'))); await rm(directory, { recursive: true, force: true }); }
});
