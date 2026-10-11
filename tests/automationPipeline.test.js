import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AutomationController } from '../automation/controller.mjs';
import { run } from '../automation/process.mjs';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

for (const batchMode of [false, true]) test(`local ${batchMode ? 'batch' : 'single'} candidate pipeline retries safely and excludes private descriptions from publication`, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'dolphin-pipeline-test-'));
  const fixture = path.join(directory, 'source'); await mkdir(path.join(fixture, 'src/services'), { recursive: true });
  await mkdir(path.join(fixture, 'src-tauri')); await mkdir(path.join(fixture, 'tests'));
  for (const [file, contents] of Object.entries({
    'src/services/example.js': 'export const value = 1;\n',
    'tests/example.test.js': '// fixture\n',
    'package.json': JSON.stringify({ name: 'dolphindata', version: '1.2.11' }),
    'package-lock.json': JSON.stringify({ name: 'dolphindata', version: '1.2.11', packages: { '': { version: '1.2.11' } } }),
    'src-tauri/Cargo.toml': '[package]\nname = "data-usage-counter"\nversion = "1.2.11"\n',
    'src-tauri/Cargo.lock': '[[package]]\nname = "data-usage-counter"\nversion = "1.2.11"\n',
    'src-tauri/tauri.conf.json': JSON.stringify({ package: { version: '1.2.11' } })
  })) await writeFile(path.join(fixture, file), contents);
  const git = args => run('git', args, { cwd: fixture });
  await git(['init', '-b', 'main']); await git(['add', '.']);
  await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture']);
  const baseSha = await git(['rev-parse', 'HEAD']); const pushTarget = path.join(directory, 'remote.git');
  await run('git', ['init', '--bare', pushTarget]);
  await git(['push', pushTarget, `${baseSha}:refs/heads/main`]);
  let prompt; let mergeCalled = false; let shouldEdit = false; let prBody;
  const execute = async (file, args, options = {}) => {
    if (file === 'codex-test') {
      prompt = options.input;
      await writeFile(args[args.indexOf('--output-last-message') + 1], shouldEdit ? '수정안을 만들고 검사를 요청했습니다.' : '개선할 화면을 확인해주세요.');
      if (shouldEdit) await writeFile(path.join(options.cwd, 'src/services/example.js'), 'export const value = 2;\n');
      return 'fake model output';
    }
    if (file === 'gh' && args[0] === 'api') {
      const endpoint = args[1];
      if (endpoint.endsWith('/commits/main')) return JSON.stringify({ sha: baseSha });
      throw new Error(`Unexpected test API ${endpoint}`);
    }
    if (file === 'gh' && args[0] === 'pr') { prBody = options.input; return 'https://github.com/DonghyuckLeeKr/DolphinData/pull/123'; }
    if (file === 'git' && args[0] === 'fetch') return run(file, ['fetch', fixture, args[2]], options);
    if (file === 'git' && args.includes('push')) { const safeArgs = args.map(arg => arg === 'https://github.com/DonghyuckLeeKr/DolphinData.git' ? pushTarget : arg); return run(file, safeArgs, options); }
    return run(file, args, options);
  };
  try {
    const controller = new AutomationController({ directory: path.join(directory, 'store'), repositoryRoot: fixture, execute, codex: 'codex-test' }); await controller.init();
    const recorder = createDiagnosticRecorder(); recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id }); recorder.observe({ connected: false }); recorder.stop();
    const view = await controller.importReport(recorder.export({ description: 'PRIVATE USER TEXT FOR REVIEW ONLY', symptom: 'other' }));
    controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true });
    let record = controller.get(view.id);
    const memberIds = [view.id];
    if (batchMode) {
      const other = createDiagnosticRecorder(); other.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id }); other.observe({ connected: false }); other.stop();
      memberIds.push((await controller.importReport(other.export({ description: 'SECOND PRIVATE TEXT FOR REVIEW ONLY', symptom: 'other' }))).id);
      const done = new Promise(resolve => {
        const changed = r => { if (r.kind === 'batch' && r.status === 'insufficient-evidence') { controller.off('change', changed); resolve(); } };
        controller.on('change', changed);
      });
      const batch = await controller.startBatch(memberIds, 'test'); record = controller.get(batch.id); await done;
      await new Promise(resolve => setImmediate(resolve));
    } else { record.status = 'fixing'; record.attempts = 1; await controller.generate(record); }
    assert.equal(record.status, 'insufficient-evidence'); assert.equal(record.aiSummary, '개선할 화면을 확인해주세요.');
    const firstWorkspace = record.workspace;
    controller.readiness = async () => ({ codex: true, previewWorkflow: true, releaseApproval: true });
    shouldEdit = true;
    const completion = new Promise((resolve, reject) => {
      const changed = r => { if (['preview-pending', 'failed'].includes(r.status)) { controller.off('change', changed); if (r.status === 'failed') reject(new Error(r.error)); else resolve(); } };
      controller.on('change', changed);
    });
    await controller.startFix(record.id, 'test'); await completion;
    assert.equal(record.status, 'preview-pending'); assert.equal(record.attempts, 2);
    assert.notEqual(firstWorkspace, record.workspace);
    assert.ok(prompt.includes('PRIVATE USER TEXT')); assert.ok(prompt.includes('untrusted data'));
    assert.ok(!prBody.includes('PRIVATE USER TEXT'));
    assert.equal(controller.list().length, batchMode ? 3 : 1); assert.equal(record.audit.filter(a => a.action === 'request-fix').length, 1);
    if (batchMode) { assert.ok(prompt.includes('SECOND PRIVATE TEXT')); assert.ok(!prBody.includes('SECOND PRIVATE TEXT')); }
    assert.equal(record.previewTitle, `Preview PR-123 ${record.candidateSha}`);
    const remoteSha = await run('git', ['--git-dir', pushTarget, 'rev-parse', `refs/heads/${record.branch}`]); assert.equal(remoteSha, record.candidateSha);
    const packageData = JSON.parse(await readFile(path.join(record.workspace, 'package.json'), 'utf8')); assert.equal(packageData.version, '1.2.12');
    assert.equal((await readFile(path.join(record.workspace, 'src/services/example.js'), 'utf8')).replace(/\r\n/g, '\n'), 'export const value = 2;\n');
    const captured = await readFile(path.join(record.workspace, 'tests', `diagnostic-capture-${record.id}.test.js`), 'utf8');
    assert.ok(!captured.includes('PRIVATE USER TEXT')); assert.ok(!captured.includes('SECOND PRIVATE TEXT'));
    for (const id of memberIds) assert.ok(captured.includes(`captured diagnostic ${id}`));
    let currentMain = 'b'.repeat(40);
    controller.api = async endpoint => {
      if (endpoint.includes('/workflows/preview-windows.yml/runs')) return { workflow_runs: [{ id: 42, display_title: record.previewTitle, head_sha: record.candidateSha, status: 'completed', conclusion: 'success', html_url: 'https://github.com/DonghyuckLeeKr/DolphinData/actions/runs/42' }] };
      if (endpoint.endsWith('/actions/runs/42')) return { conclusion: 'success', display_title: record.previewTitle, head_sha: record.candidateSha };
      if (endpoint.endsWith('/pulls/123')) return { state: 'open', head: { sha: record.candidateSha, repo: { full_name: 'DonghyuckLeeKr/DolphinData' } }, base: { ref: 'main' } };
      if (endpoint.endsWith('/commits/main')) return { sha: currentMain };
      if (endpoint.endsWith(`/git/commits/${record.candidateSha}`)) return { tree: { sha: record.candidateTree }, parents: [{ sha: baseSha }] };
      if (endpoint.includes('/contents/package.json')) return { content: Buffer.from(JSON.stringify(packageData)).toString('base64') };
      if (endpoint.endsWith('/merge')) { mergeCalled = true; return {}; }
      throw new Error(`Unexpected approval API ${endpoint}`);
    };
    await controller.refresh(record.id); assert.equal(record.status, 'review-ready');
    if (batchMode) for (const id of memberIds) {
      const member = controller.view(controller.get(id)); assert.equal(member.batchStatus, 'review-ready'); assert.equal(member.canRequestFix, false);
    }
    controller.readiness = async () => ({ releaseApproval: true });
    await assert.rejects(controller.approveCode(record.id, { sha: record.candidateSha, patchDigest: record.patchDigest, actor: 'test' }), /코드가 바뀌었습니다/);
    assert.equal(mergeCalled, false); assert.equal(controller.busy, false);
    currentMain = baseSha; record.status = 'review-ready';
    await controller.approveCode(record.id, { sha: record.candidateSha, patchDigest: record.patchDigest, actor: 'test' });
    assert.equal(record.status, 'release-pending'); assert.equal(record.releaseSha, record.candidateSha);
    assert.equal(await run('git', ['--git-dir', pushTarget, 'rev-parse', 'refs/heads/main']), record.candidateSha);
    assert.equal(await run('git', ['--git-dir', pushTarget, 'rev-parse', 'refs/tags/v1.2.12']), record.candidateSha);
  } finally {
    assert.ok(path.resolve(directory).startsWith(path.join(os.tmpdir(), 'dolphin-pipeline-test-')));
    await rm(directory, { recursive: true, force: true });
  }
});
