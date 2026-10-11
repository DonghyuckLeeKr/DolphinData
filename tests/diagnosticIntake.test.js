import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { createIntakeServer } from '../automation/intake.mjs';
import { AutomationController } from '../automation/controller.mjs';
import { createDiagnosticRecorder, MAX_DIAGNOSTIC_BYTES } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

const report = () => { const recorder = createDiagnosticRecorder(); recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id }); recorder.observe({ connected: false }); return recorder.export(); };
test('public intake returns only receipts; concurrent retries persist/publish once, including after restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-intake-'));
  const controller = new AutomationController({ directory, repositoryRoot: process.cwd() }); await controller.init();
  let cards = 0; controller.on('change', () => cards++);
  const intake = await createIntakeServer(controller, { port: 0 }); const origin = new URL(intake.url).origin;
  const body = JSON.stringify(report());
  const post = value => fetch(intake.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: value });
  try {
    const responses = await Promise.all([post(body), post(body)]);
    const receipts = await Promise.all(responses.map(response => { assert.equal(response.status, 201); return response.json(); }));
    assert.deepEqual(receipts[0], receipts[1]); assert.deepEqual(Object.keys(receipts[0]).sort(), ['receiptId', 'receivedAt', 'reportId']);
    assert.equal(controller.list().length, 1); assert.equal(cards, 1);
    const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init();
    assert.equal((await reloaded.importReport(body)).id, receipts[0].receiptId);
    assert.equal((await fetch(`${origin}/api/reports`)).status, 404);
    assert.equal((await fetch(`${origin}/api/status`)).status, 404);
    assert.equal((await fetch(intake.url, { method: 'POST', headers: { Origin: 'https://evil.example' }, body })).status, 403);
    assert.equal((await post(JSON.stringify({ ...JSON.parse(body), description: 'changed after already accepted' }))).status, 400);
    assert.equal((await post('{"secret":"bad"}')).status, 400);
    assert.equal((await post('x'.repeat(MAX_DIAGNOSTIC_BYTES + 1))).status, 413);
    assert.equal((await fetch(`${origin}/v1/status`)).status, 200);
  } finally { await new Promise(resolve => intake.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
test('intake rate limit resets and does not admit operator actions', async () => {
  let clock = 0; let imports = 0;
  const intake = await createIntakeServer({ importReport: async raw => { imports++; const value = JSON.parse(raw); return { report: value, id: value.reportId, createdAt: '2026-10-11T00:00:00Z' }; } }, { port: 0, limit: 1, clock: () => clock });
  const post = () => fetch(intake.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
  try {
    assert.equal((await post()).status, 201); const limited = await post(); assert.equal(limited.status, 429); assert.equal(limited.headers.get('Retry-After'), '60');
    clock = 60000; assert.equal((await post()).status, 201); assert.equal(imports, 2);
  } finally { await new Promise(resolve => intake.server.close(resolve)); }
});
