import { EventEmitter } from 'node:events';
import { mkdir, readFile, writeFile, rename, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseDiagnosticReport, publicDiagnosticContext, redactDescription } from '../src/services/diagnosticService.js';
import { buildFixPrompt, buildBatchFixPrompt, canRequestFix, codexFixArguments, assertFixEvidence, MAX_BATCH_REPORTS } from './fixRequest.mjs';
import { replayDiagnosticReport } from '../src/services/diagnosticReplay.js';
import { REPOSITORY, isId, isSha, digest, assertAllowedChanges, assertApproval } from './policy.mjs';
import { run, agentEnvironment, UNTRUSTED_GIT_CONFIG } from './process.mjs';

export class AutomationController extends EventEmitter {
  constructor({ directory, repositoryRoot, execute = run, codex = 'codex' }) {
    super(); this.directory = directory; this.repositoryRoot = repositoryRoot; this.execute = execute; this.codex = codex;
    this.records = new Map(); this.busy = false; this.emittedVersions = new Map(); this.readinessCache = null; this.saveChains = new Map();
    this.importChain = Promise.resolve();
  }
  async init() {
    await mkdir(this.directory, { recursive: true });
    for (const file of await readdir(this.directory)) {
      if (!/^[a-f0-9-]+\.json$/.test(file)) continue;
      const record = JSON.parse(await readFile(path.join(this.directory, file), 'utf8'));
      if (!isId(record.id)) continue;
      record.report = parseDiagnosticReport(record.report);
      if (['fixing', 'approving'].includes(record.status)) { record.status = 'interrupted'; record.error = 'PC 종료로 중단되었습니다. GitHub 상태를 확인한 뒤 새 요청을 시작해주세요.'; }
      this.records.set(record.id, record);
    }
    const assigned = new Set();
    for (const record of this.records.values()) {
      if (record.kind !== 'batch') continue;
      if (!Array.isArray(record.reportIds) || record.reportIds.length < 2 || record.reportIds.length > MAX_BATCH_REPORTS
        || new Set(record.reportIds).size !== record.reportIds.length
        || record.reportIds.some(id => !isId(id) || !this.records.has(id) || this.records.get(id).kind === 'batch' || (record.status !== 'retired' && assigned.has(id)))) {
        throw new Error('일괄 처리 기록의 접수 연결이 올바르지 않습니다. 저장 기록을 확인해주세요.');
      }
      if (record.status !== 'retired') record.reportIds.forEach(id => assigned.add(id));
    }
  }
  list() { return [...this.records.values()].map(r => this.view(r)); }
  view(record) {
    const { workspace: _workspace, ...rest } = record;
    const batch = record.kind === 'batch' ? null : [...this.records.values()].find(r => r.kind === 'batch' && r.status !== 'retired' && r.reportIds.includes(record.id));
    const membership = batch ? { status: 'batched', batchId: batch.id, batchStatus: batch.status, batchPrUrl: batch.prUrl } : {};
    return { ...rest, ...membership, canRequestFix: canRequestFix({ ...record, ...membership }),
      ...(record.candidateHistory ? { candidateHistory: record.candidateHistory.map(({ workspace: _workspace, ...candidate }) => candidate) } : {}),
      ...(record.kind === 'batch' ? { reports: record.reportIds.map(id => {
        const r = this.get(id); return { id, description: r.report.description, symptom: r.report.symptom, appVersion: r.report.appVersion, eventCount: r.report.events.length };
      }) } : {}) };
  }
  get(id) { if (!isId(id) || !this.records.has(id)) throw new Error('리포트를 찾을 수 없습니다.'); return this.records.get(id); }
  async save(record) {
    const snapshot = JSON.parse(JSON.stringify(record));
    const save = (this.saveChains.get(record.id) || Promise.resolve()).catch(() => {}).then(async () => {
      const file = path.join(this.directory, `${record.id}.json`);
      await writeFile(`${file}.tmp`, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
      await rename(`${file}.tmp`, file); this.records.set(record.id, record);
      const version = digest(JSON.stringify(this.view(snapshot)));
      if (this.emittedVersions.get(record.id) !== version) {
        this.emittedVersions.set(record.id, version); this.emit('change', this.view(snapshot));
        if (record.kind === 'batch') for (const id of record.reportIds) this.emit('change', this.view(this.get(id)));
      }
    });
    this.saveChains.set(record.id, save); await save;
  }
  // Only the local admin is trusted; anything else waits for owner triage before daily AI processing.
  async importReport(raw, { trusted = false } = {}) {
    const report = parseDiagnosticReport(raw);
    const imported = this.importChain.catch(() => {}).then(async () => {
      const reports = [...this.records.values()].filter(r => r.kind !== 'batch');
      const existing = reports.find(r => r.report.reportId === report.reportId);
      if (existing) {
        if (digest(JSON.stringify(existing.report)) !== digest(JSON.stringify(report))) throw new Error('이미 접수한 기록입니다. 새 기록을 시작해주세요.');
        return this.view(existing);
      }
      if (reports.length >= 200) throw new Error('보관 한도 200개에 도달했습니다. 저장 폴더의 오래된 리포트를 정리해주세요.');
      const record = { id: randomUUID(), report, replay: replayDiagnosticReport(report), status: 'received', createdAt: new Date().toISOString(), audit: [],
        ...(trusted ? {} : { autoProcessExcluded: true, triagePending: true }) };
      record.audit.push({ at: record.createdAt, action: 'import' }); await this.save(record); return this.view(record);
    });
    this.importChain = imported;
    return imported;
  }
  // The AI controlled this tree: never run its hooks/fsmonitor, and keep operator secrets out of git's environment.
  untrustedGit(workspace, args) { return this.execute('git', [...UNTRUSTED_GIT_CONFIG, ...args], { cwd: workspace, env: agentEnvironment(process.env) }); }
  gh(args, options = {}) { return this.execute('gh', args, { cwd: this.repositoryRoot, ...options }); }
  api(endpoint, fields, method = 'POST') {
    return this.gh(['api', endpoint, ...(fields ? ['--method', method, '--input', '-'] : [])], fields ? { input: JSON.stringify(fields) } : {} ).then(text => text ? JSON.parse(text) : null);
  }
  async readiness() {
    if (this.readinessCache && Date.now() - this.readinessCache.at < 60000) return { ...this.readinessCache.value, busy: this.busy };
    const results = await Promise.allSettled([
      this.execute(this.codex, ['login', 'status'], { timeout: 10000 }),
      this.api(`repos/${REPOSITORY}/actions/workflows/preview-windows.yml`),
      this.api(`repos/${REPOSITORY}/environments/production`),
      this.api(`repos/${REPOSITORY}/contents/.github/workflows/preview-windows.yml?ref=main`)
    ]);
    const value = { codex: results[0].status === 'fulfilled', previewWorkflow: results[1].status === 'fulfilled'
      && results[3].status === 'fulfilled' && results[3].value?.type === 'file',
      releaseApproval: results[2].status === 'fulfilled' && (results[2].value.protection_rules || []).some(r => r.type === 'required_reviewers' && r.reviewers?.length),
      busy: this.busy };
    this.readinessCache = { at: Date.now(), value }; return value;
  }
  async startFix(id, actor, metadata = {}) {
    const record = this.get(id);
    if (this.busy || !canRequestFix(this.view(record))) throw new Error('실행 중인 작업이 있거나 이미 검토용 수정본 또는 일괄 처리에 연결된 리포트입니다.');
    this.busy = true;
    try {
      const ready = await this.readiness();
      if (!ready.codex) throw new Error('Codex에 먼저 로그인해주세요.');
      if (!ready.previewWorkflow) throw new Error('먼저 자동화 변경을 main에 반영해 GitHub 검사 작업을 등록해주세요.');
      for (const r of this.fixReports(record)) assertFixEvidence(r);
      if (metadata.dailyRunDate) { record.dailyRunDate = metadata.dailyRunDate; record.dailyRemaining = metadata.dailyRemaining; }
      record.attempts = (Number.isSafeInteger(record.attempts) ? record.attempts : 0) + 1;
      record.status = 'fixing'; record.error = ''; record.aiSummary = ''; record.audit.push({ at: new Date().toISOString(), actor, action: 'request-fix', attempt: record.attempts }); await this.save(record);
    } catch (e) { this.busy = false; throw e; }
    this.runFix(record);
    return this.view(record);
  }
  async startBatch(ids, actor, metadata = {}) {
    if (this.busy) throw new Error('현재 작업이 끝난 뒤 일괄 처리를 시작해주세요. 접수는 계속 보관됩니다.');
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > MAX_BATCH_REPORTS || new Set(ids).size !== ids.length) {
      throw new Error(`서로 다른 접수 2~${MAX_BATCH_REPORTS}개를 선택해주세요.`);
    }
    const members = ids.map(id => this.get(id));
    for (const member of members) {
      if (member.kind === 'batch' || !canRequestFix(this.view(member))) throw new Error('이미 처리 중이거나 수정안에 연결된 접수는 함께 처리할 수 없습니다.');
      assertFixEvidence(member);
    }
    this.busy = true;
    try {
      const ready = await this.readiness();
      if (!ready.codex || !ready.previewWorkflow) throw new Error('Codex 로그인과 GitHub 검사 작업을 먼저 확인해주세요.');
      const at = new Date().toISOString();
      const record = { id: randomUUID(), kind: 'batch', reportIds: [...ids], report: members[0].report, replay: members[0].replay,
        status: 'fixing', attempts: 1, createdAt: at, audit: [{ at, actor, action: 'request-batch', reportIds: [...ids] }],
        ...(metadata.dailyRunDate ? { dailyRunDate: metadata.dailyRunDate, dailyRemaining: metadata.dailyRemaining } : {}) };
      await this.save(record); this.runFix(record); return this.view(record);
    } catch (error) { this.busy = false; throw error; }
  }
  fixReports(record) { return record.kind === 'batch' ? record.reportIds.map(id => this.get(id)) : [record]; }
  async setAutomatic(id, allowed, actor) {
    const record = this.get(id);
    if (typeof allowed !== 'boolean' || record.kind === 'batch') throw new Error('접수의 자동 처리 포함 여부를 확인해주세요.');
    record.autoProcessExcluded = !allowed; delete record.triagePending; record.audit.push({ at: new Date().toISOString(), actor, action: 'set-automatic', allowed });
    await this.save(record); return this.view(record);
  }
  runFix(record) {
    // The owner selects the entire batch before one candidate is generated.
    this.generate(record).catch(async error => { record.status = 'failed'; record.error = this.safeError(error); await this.save(record); }).finally(() => { this.busy = false; });
  }
  safeError(error) { return String(error.message || error).replace(/(?:gh[pousr]_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/g, '[비밀키]').slice(0, 2000); }
  async generate(record) {
    const base = await this.api(`repos/${REPOSITORY}/commits/main`); record.baseSha = base.sha;
    if (!isSha(base.sha)) throw new Error('기준 커밋을 확인할 수 없습니다.');
    let workspace = path.join(this.directory, 'candidates', `${record.id}-attempt-${record.attempts || 1}`); await mkdir(path.dirname(workspace), { recursive: true });
    // A standalone clone has no shared Git metadata with the operator checkout.
    await this.execute('git', ['clone', '--no-hardlinks', '--no-checkout', this.repositoryRoot, workspace]);
    await this.execute('git', ['fetch', `https://github.com/${REPOSITORY}.git`, base.sha], { cwd: workspace });
    await this.execute('git', ['checkout', '--detach', base.sha], { cwd: workspace });
    await this.execute('git', ['remote', 'remove', 'origin'], { cwd: workspace });
    const gitConfig = await readFile(path.join(workspace, '.git', 'config'), 'utf8');
    record.workspace = workspace; await this.save(record);
    const reports = this.fixReports(record);
    const prompt = record.kind === 'batch' ? buildBatchFixPrompt(reports) : buildFixPrompt(record.report);
    const summaryPath = path.join(this.directory, `${record.id}-attempt-${record.attempts || 1}-summary.txt`);
    await this.execute(this.codex, codexFixArguments(workspace, summaryPath),
    { cwd: workspace, input: prompt, env: agentEnvironment(process.env), timeout: 20 * 60000, maxBytes: 8 * 1024 * 1024 });
    record.aiSummary = this.safeError(redactDescription(await readFile(summaryPath, 'utf8').catch(() => '')));
    // Trust only the diff; reject commits/config rewrites as well as forbidden files.
    if (await readFile(path.join(workspace, '.git', 'config'), 'utf8') !== gitConfig) throw new Error('AI가 Git 설정을 변경했습니다.');
    if (await this.untrustedGit(workspace, ['rev-parse', 'HEAD']) !== record.baseSha) throw new Error('AI가 기준 커밋을 변경했습니다.');
    await this.untrustedGit(workspace, ['add', '-A']);
    const names = await this.untrustedGit(workspace, ['diff', '--cached', '--name-status', '--no-renames']);
    if (!names) { record.status = 'insufficient-evidence'; record.error = '수정안이 생성되지 않았습니다. 아래 AI 처리 결과를 확인한 뒤 같은 리포트로 다시 요청할 수 있습니다.'; await this.save(record); return; }
    const entries = [];
    for (const line of names.split('\n')) {
      const [status, file] = line.split('\t');
      const tree = await this.untrustedGit(workspace, ['ls-files', '--stage', '--', file]);
      const mode = status === 'D' ? '100644' : tree.slice(0, 6);
      entries.push({ status, path: file, mode });
      if (status !== 'D' && !(await lstat(path.join(workspace, file))).isFile()) throw new Error('일반 파일만 수정할 수 있습니다.');
    }
    assertAllowedChanges(entries);
    const patch = await this.untrustedGit(workspace, ['diff', '--cached', '--binary', '--no-renames', '--no-ext-diff', '--no-textconv']);
    if (Buffer.byteLength(patch) > 512 * 1024 || /GIT binary patch|old mode|new mode/.test(patch)) throw new Error('변경 크기 또는 파일 형식이 허용 범위를 벗어났습니다.');
    if (reports.some(r => r.report.description.trim().length >= 12 && patch.includes(r.report.description.trim()))) throw new Error('사용자의 비공개 설명이 수정 파일에 포함돼 공개를 중단했습니다.');
    record.patchDigest = digest(patch); record.files = entries;
    await writeFile(path.join(this.directory, `${record.id}.patch`), patch, { mode: 0o600 });
    // Discard all AI-controlled Git metadata. Publication uses a new trusted clone.
    const reviewWorkspace = `${workspace}-review`;
    await this.execute('git', ['clone', '--no-hardlinks', '--no-checkout', this.repositoryRoot, reviewWorkspace]);
    await this.execute('git', ['fetch', `https://github.com/${REPOSITORY}.git`, record.baseSha], { cwd: reviewWorkspace });
    await this.execute('git', ['checkout', '--detach', record.baseSha], { cwd: reviewWorkspace });
    await this.execute('git', ['apply', '--index', '-'], { cwd: reviewWorkspace, input: patch + '\n' });
    workspace = reviewWorkspace; record.workspace = workspace;
    // This captured scenario must pass on CI independently of AI-authored tests.
    const replayTest = `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { replayDiagnosticReport } from '../src/services/diagnosticReplay.js';\n` +
      reports.map(r => {
        const context = publicDiagnosticContext(r.report);
        return `test('captured diagnostic ${r.id}', () => {\n const result = replayDiagnosticReport(${JSON.stringify(context)});\n` +
          (['same-router-reconnect', 'disconnect-prompt'].includes(context.symptom) ? ` assert.equal(result.status, 'not-reproduced');\n` : ` assert.ok(result.finalConfig.profiles.length > 0);\n`) + `});\n`;
      }).join('');
    await writeFile(path.join(workspace, 'tests', `diagnostic-capture-${record.id}.test.js`), replayTest);
    // Version bump is operator-controlled, outside the AI's edit scope.
    await this.bumpVersion(workspace);
    await this.execute('git', ['add', 'package.json', 'package-lock.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', `tests/diagnostic-capture-${record.id}.test.js`], { cwd: workspace });
    await this.execute('git', ['-c', 'core.hooksPath=NUL', '-c', 'commit.gpgsign=false', '-c', 'user.name=DolphinData Automation', '-c', 'user.email=automation@users.noreply.github.com',
      'commit', '-m', `fix: diagnostic ${record.id}`], { cwd: workspace });
    record.candidateSha = await this.execute('git', ['rev-parse', 'HEAD'], { cwd: workspace });
    record.candidateTree = await this.execute('git', ['rev-parse', 'HEAD^{tree}'], { cwd: workspace });
    record.branch = `codex/report-${record.id}-attempt-${record.attempts || 1}`;
    // Push a fresh, known commit from the trusted controller, never from the AI process.
    await this.execute('git', ['-c', 'core.hooksPath=NUL', 'push', `https://github.com/${REPOSITORY}.git`, `HEAD:refs/heads/${record.branch}`], { cwd: workspace });
    const body = `Local diagnostic ${record.id}\n\nReports (${reports.length}):\n${reports.map(r => `- ${r.id}: ${r.report.symptom}`).join('\n')}\nPatch SHA256: ${record.patchDigest}\n\nPrivate free text and raw device identifiers are excluded. Review source and the Windows preview before approval.\n`;
    record.prUrl = await this.gh(['pr', 'create', '--repo', REPOSITORY, '--base', 'main', '--head', record.branch, '--draft', '--title', `${record.kind === 'batch' ? 'Batch' : 'Diagnostic'} fix ${record.id}`, '--body-file', '-'], { input: body });
    record.prNumber = Number(record.prUrl.split('/').pop());
    record.previewTitle = `Preview PR-${record.prNumber} ${record.candidateSha}`;
    record.status = 'preview-pending'; await this.save(record);
  }
  async bumpVersion(workspace) {
    const pkgPath = path.join(workspace, 'package.json'); const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
    const oldVersion = pkg.version; if (!/^\d+\.\d+\.\d+$/.test(oldVersion)) throw new Error('버전 형식을 확인해주세요.');
    const parts = oldVersion.split('.').map(Number); parts[2]++; const version = parts.join('.'); pkg.version = version;
    await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
    const lockPath = path.join(workspace, 'package-lock.json'); const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    lock.version = version; lock.packages[''].version = version; await writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
    const configPath = path.join(workspace, 'src-tauri/tauri.conf.json'); const config = JSON.parse(await readFile(configPath, 'utf8'));
    config.package.version = version; await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    for (const file of ['src-tauri/Cargo.toml', 'src-tauri/Cargo.lock']) {
      const filePath = path.join(workspace, file); const text = await readFile(filePath, 'utf8');
      // Cargo.lock may contain many package versions: replace only this application block.
      const changed = file.endsWith('.toml') ? text.replace(/^(version\s*=\s*)"[^"]+"/m, `$1"${version}"`)
        : text.replace(/(name = "(?:data-usage-counter|dolphindata|data_usage_counter|DolphinData)"\r?\nversion = )"[^"]+"/, `$1"${version}"`);
      if (changed === text) throw new Error(`${file} 앱 버전을 갱신할 수 없습니다.`);
      await writeFile(filePath, changed);
    }
  }
  async refresh(id) {
    const r = this.get(id);
    if (r.prNumber && ['preview-pending', 'review-ready', 'failed', 'approval-failed'].includes(r.status)) {
      const pr = await this.api(`repos/${REPOSITORY}/pulls/${r.prNumber}`);
      if (pr.state === 'closed' && !pr.merged_at) {
        r.status = 'candidate-closed'; r.error = 'GitHub에서 수정안이 닫혔습니다. 다시 대기로 돌리면 기존 수정안 이력을 보존하고 새 작업에 포함할 수 있습니다.';
        await this.save(r); return this.view(r);
      }
    }
    if (r.status === 'preview-pending') {
      const data = await this.api(`repos/${REPOSITORY}/actions/workflows/preview-windows.yml/runs?event=pull_request&head_sha=${r.candidateSha}&per_page=50`);
      const matching = data.workflow_runs.filter(run => run.display_title === r.previewTitle);
      if (matching.length > 1) throw new Error('중복 검사 실행을 확인해주세요.');
      const preview = matching[0];
      if (preview) {
        r.previewRunId = preview.id; r.previewUrl = preview.html_url; r.previewConclusion = preview.conclusion;
        if (preview.status === 'completed') { r.status = preview.conclusion === 'success' ? 'review-ready' : 'failed'; if (r.status === 'failed') r.error = 'Windows 검사 또는 설치파일 빌드에 실패했습니다.'; }
        await this.save(r);
      }
    }
    if (r.status === 'release-pending') {
      const data = await this.api(`repos/${REPOSITORY}/actions/workflows/release-windows.yml/runs?head_sha=${r.releaseSha}&per_page=20`);
      const releases = data.workflow_runs.filter(run => run.head_sha === r.releaseSha && run.head_branch === r.releaseTag);
      const release = releases[0];
      if (release) { r.releaseRunId = release.id; r.releaseUrl = release.html_url;
        if (release.status === 'completed') { r.status = release.conclusion === 'success' ? 'released' : 'release-failed'; }
        await this.save(r);
      }
    }
    return this.view(r);
  }
  async approveCode(id, { sha, patchDigest, actor }) {
    const r = this.get(id); assertApproval(r, sha, patchDigest);
    if (this.busy) throw new Error('다른 작업이 실행 중입니다.');
    this.busy = true;
    try {
      const readiness = await this.readiness(); if (!readiness.releaseApproval) throw new Error('GitHub production 환경에 승인자를 먼저 지정해주세요.');
      const preview = await this.api(`repos/${REPOSITORY}/actions/runs/${r.previewRunId}`);
      if (preview.conclusion !== 'success' || preview.display_title !== r.previewTitle || preview.head_sha !== sha) throw new Error('검사 결과가 승인 대상과 다릅니다.');
      const pr = await this.api(`repos/${REPOSITORY}/pulls/${r.prNumber}`);
      if (pr.state !== 'open') throw new Error('GitHub에서 닫힌 수정안은 승인할 수 없습니다. 접수 상태를 새로 확인해주세요.');
      const main = await this.api(`repos/${REPOSITORY}/commits/main`);
      if (pr.head.sha !== sha || pr.base.ref !== 'main' || pr.head.repo.full_name !== REPOSITORY || main.sha !== r.baseSha) throw new Error('GitHub 코드가 바뀌었습니다. 새 기준으로 다시 수정·검사해주세요.');
      r.status = 'approving'; r.audit.push({ at: new Date().toISOString(), actor, action: 'approve-code', sha, patchDigest }); await this.save(r);
      await this.gh(['pr', 'ready', String(r.prNumber), '--repo', REPOSITORY]);
      const commit = await this.api(`repos/${REPOSITORY}/git/commits/${sha}`);
      if (commit.tree.sha !== r.candidateTree || commit.parents.length !== 1 || commit.parents[0].sha !== r.baseSha) throw new Error('수정본의 기준 또는 코드가 검사 결과와 다릅니다.');
      // Atomic compare-and-update: even a main update racing this approval is rejected.
      // The approved commit is a direct child of base, so this is a fast-forward.
      await this.execute('git', ['-c', 'core.hooksPath=NUL', 'push', `--force-with-lease=refs/heads/main:${r.baseSha}`,
        `https://github.com/${REPOSITORY}.git`, `${sha}:refs/heads/main`], { cwd: r.workspace });
      r.releaseSha = sha;
      const versionData = await this.api(`repos/${REPOSITORY}/contents/package.json?ref=${sha}`);
      const version = JSON.parse(Buffer.from(versionData.content, 'base64')).version;
      if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('배포 버전이 유효하지 않습니다.');
      r.releaseTag = `v${version}`;
      await this.save(r);
      await this.execute('git', ['-c', 'core.hooksPath=NUL', 'push', `https://github.com/${REPOSITORY}.git`, `${sha}:refs/tags/${r.releaseTag}`], { cwd: r.workspace });
      r.status = 'release-pending'; await this.save(r);
    } catch (e) { r.status = 'approval-failed'; r.error = this.safeError(e); await this.save(r); throw e; }
    finally { this.busy = false; }
    return this.view(r);
  }
  async returnToQueue(id, actor, { keepBatch = false } = {}) {
    const r = this.get(id);
    if (keepBatch && r.kind !== 'batch') throw new Error('같은 묶음 재시도는 일괄 수정에만 사용할 수 있습니다.');
    if (this.busy || r.status !== 'candidate-closed' || r.releaseSha) throw new Error('닫힌 수정안만 접수 대기로 돌릴 수 있습니다.');
    this.busy = true;
    try {
      const pr = await this.api(`repos/${REPOSITORY}/pulls/${r.prNumber}`);
      if (pr.state !== 'closed' || pr.merged_at) throw new Error('닫히지 않았거나 이미 반영된 수정안은 대기로 돌릴 수 없습니다.');
      const previous = {};
      for (const key of ['baseSha', 'workspace', 'patchDigest', 'files', 'candidateSha', 'candidateTree', 'branch', 'prUrl', 'prNumber', 'previewTitle', 'previewRunId', 'previewUrl', 'previewConclusion', 'aiSummary']) {
        if (r[key] !== undefined) { previous[key] = r[key]; delete r[key]; }
      }
      (r.candidateHistory ||= []).push(previous);
      r.status = r.kind === 'batch' && !keepBatch ? 'retired' : 'received'; r.error = '';
      r.audit.push({ at: new Date().toISOString(), actor, action: 'return-to-queue', previousSha: previous.candidateSha, keepBatch });
      await this.save(r); return this.view(r);
    } finally { this.busy = false; }
  }
  async approveRelease(id, actor, runId) {
    const r = this.get(id);
    if (r.status !== 'release-pending' || !r.releaseRunId || r.releaseRunId !== runId) throw new Error('승인 대기 중인 배포를 찾을 수 없습니다.');
    const runData = await this.api(`repos/${REPOSITORY}/actions/runs/${runId}`);
    if (runData.head_sha !== r.releaseSha || runData.head_branch !== r.releaseTag || !['waiting', 'in_progress'].includes(runData.status)) throw new Error('배포 코드가 승인한 코드와 다릅니다.');
    const deployments = await this.api(`repos/${REPOSITORY}/actions/runs/${runId}/pending_deployments`);
    const production = deployments.find(d => d.environment.name === 'production');
    if (!production?.current_user_can_approve) throw new Error('GitHub 승인 권한이 없거나 배포가 아직 승인 대기 상태가 아닙니다.');
    await this.api(`repos/${REPOSITORY}/actions/runs/${runId}/pending_deployments`, { environment_ids: [production.environment.id], state: 'approved', comment: `Discord/local approval ${r.id}; commit ${r.releaseSha}` });
    r.audit.push({ at: new Date().toISOString(), actor, action: 'approve-release', sha: r.releaseSha, runId }); await this.save(r); return this.view(r);
  }
}
