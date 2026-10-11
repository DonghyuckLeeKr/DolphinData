import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { AutomationController } from '../automation/controller.mjs';
import { createAdminServer } from '../automation/server.mjs';
import { assertAllowedChanges, assertApproval, authorizeDiscord, digest } from '../automation/policy.mjs';
import { agentEnvironment } from '../automation/process.mjs';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

const report = () => {
  const recorder = createDiagnosticRecorder({ id: () => '12345678-1234-1234-1234-123456789abc' });
  recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id }); recorder.observe({ connected: false }); recorder.stop(); return recorder.export();
};
const sha = 'a'.repeat(40);
test('auto edit policy blocks workflow/dependency/secret paths and symlinks', () => {
  assert.doesNotThrow(() => assertAllowedChanges([{ path: 'src/services/networkObservation.js', status: 'M', mode: '100644' }]));
  for (const file of ['.github/workflows/release.yml', 'package.json', 'automation/controller.mjs', 'src/../../secret.js']) {
    assert.throws(() => assertAllowedChanges([{ path: file, status: 'M', mode: '100644' }]));
  }
  assert.throws(() => assertAllowedChanges([{ path: 'src/a.js', status: 'A', mode: '120000' }]));
});
test('approvals bind exact commit, patch and successful preview', () => {
  const ready = { status: 'review-ready', candidateSha: sha, patchDigest: digest('patch'), previewRunId: 42, previewConclusion: 'success' };
  assert.doesNotThrow(() => assertApproval(ready, sha, ready.patchDigest));
  assert.throws(() => assertApproval(ready, 'b'.repeat(40), ready.patchDigest));
  assert.throws(() => assertApproval(ready, sha, digest('different')));
  assert.throws(() => assertApproval({ ...ready, previewConclusion: 'failure' }, sha, ready.patchDigest));
});
test('Discord approvals require exact owner, guild and channel; role labels are insufficient', () => {
  const config = { guildId: 'server', channelId: 'channel', ownerId: 'owner' };
  const interaction = { guildId: 'server', channelId: 'channel', user: { id: 'owner' } };
  assert.equal(authorizeDiscord(interaction, config), true);
  assert.equal(authorizeDiscord({ ...interaction, user: { id: 'stranger' } }, config), false);
  assert.equal(authorizeDiscord({ ...interaction, channelId: 'other' }, config), false);
  assert.equal(authorizeDiscord({ ...interaction, guildId: 'other' }, config), false);
  assert.equal(authorizeDiscord(interaction, {}), false);
});
test('AI process does not inherit GitHub, Discord or signing credentials', () => {
  assert.deepEqual(agentEnvironment({ PATH: 'bin', LOCALAPPDATA: 'local', GH_TOKEN: 'secret', DOLPHIN_DISCORD_TOKEN: 'secret', TAURI_PRIVATE_KEY: 'secret' }), { PATH: 'bin', LOCALAPPDATA: 'local' });
});
test('local report intake persists/reloads and loopback API rejects unauthorized/foreign origins', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-automation-test-'));
  const controller = new AutomationController({ directory, repositoryRoot: process.cwd(), execute: async () => '' }); await controller.init();
  controller.readiness = async () => ({ codex: true, previewWorkflow: false, releaseApproval: false });
  const admin = await createAdminServer(controller, { port: 0, token: 'test-token' }); const origin = new URL(admin.url).origin;
  try {
    assert.equal((await fetch(`${origin}/api/reports`)).status, 401);
    assert.equal((await fetch(`${origin}/api/reports`, { headers: { Authorization: 'Bearer test-token', Origin: 'https://evil.example' } })).status, 403);
    const response = await fetch(`${origin}/api/reports`, { method: 'POST', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' }, body: JSON.stringify(report()) });
    assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.status, 'received');
    assert.equal(JSON.parse(await readFile(path.join(directory, `${saved.id}.json`), 'utf8')).id, saved.id);
    const reloaded = new AutomationController({ directory, repositoryRoot: process.cwd() }); await reloaded.init(); assert.equal(reloaded.list().length, 1);
    const failFix = await fetch(`${origin}/api/reports/${saved.id}/fix`, { method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: '{}' });
    assert.equal(failFix.status, 400); assert.equal(controller.busy, false); assert.equal(controller.get(saved.id).status, 'received');
  } finally { await new Promise(resolve => admin.server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});
test('production release workflow gates signing and publishing on approval', async () => {
  const workflow = await readFile('.github/workflows/release-windows.yml', 'utf8');
  assert.match(workflow, /environment: production/);
  const preview = await readFile('.github/workflows/preview-windows.yml', 'utf8');
  assert.ok(!preview.includes('TAURI_PRIVATE_KEY')); assert.ok(!preview.includes('contents: write'));
});
