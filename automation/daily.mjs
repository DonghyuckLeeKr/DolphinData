import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { assertFixEvidence, MAX_BATCH_REPORTS } from './fixRequest.mjs';

export const seoulDay = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const activeStates = new Set(['fixing', 'preview-pending', 'review-ready', 'approving', 'release-pending', 'approval-failed', 'release-failed']);

export function dailyPlan(controller) {
  const records = controller.list();
  const pending = records.filter(r => r.kind !== 'batch' && r.status === 'received' && r.canRequestFix && !r.autoProcessExcluded)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const eligible = [], insufficient = [];
  for (const record of pending) {
    try { assertFixEvidence(record); eligible.push(record.id); }
    catch (error) { insufficient.push({ id: record.id, reason: controller.safeError(error) }); }
  }
  return { ids: eligible.slice(0, MAX_BATCH_REPORTS), remaining: Math.max(0, eligible.length - MAX_BATCH_REPORTS), insufficient,
    excluded: records.filter(r => r.kind !== 'batch' && r.status === 'received' && r.autoProcessExcluded && !r.triagePending).length,
    awaitingTriage: records.filter(r => r.kind !== 'batch' && r.status === 'received' && r.triagePending).length,
    blockers: records.filter(r => activeStates.has(r.status) || (r.candidateSha && !['released', 'candidate-closed', 'retired'].includes(r.status))).map(r => r.id), busy: controller.busy };
}

export class DailyBatchRunner {
  constructor(controller, { now = () => new Date() } = {}) {
    this.controller = controller; this.now = now; this.chain = Promise.resolve(); this.history = [];
    this.config = { enabled: false, time: '21:00', timeZone: 'Asia/Seoul' };
  }
  async init() {
    try { this.history = JSON.parse(await readFile(this.file('daily-runs.json'), 'utf8')).runs; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('일일 실행 기록을 확인할 수 없습니다.'); }
    if (!Array.isArray(this.history) || this.history.some(r => !r || !/^\d{4}-\d{2}-\d{2}$/.test(r.day) || typeof r.state !== 'string')) throw new Error('일일 실행 기록 형식이 올바르지 않습니다.');
    try { this.config = this.validateConfig(JSON.parse(await readFile(this.file('daily-config.json'), 'utf8'))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    // A reservation made before a crash must never trigger another AI process.
    for (const run of this.history.filter(r => r.state === 'preparing')) {
      const job = this.controller.list().find(r => r.dailyRunDate === run.day);
      run.state = job ? 'started' : 'interrupted'; if (job) run.jobId = job.id;
    }
  }
  file(name) { return path.join(this.controller.directory, name); }
  validateConfig(config) {
    if (typeof config.enabled !== 'boolean' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.time) || config.timeZone !== 'Asia/Seoul') throw new Error('한국 시간의 일일 예약 설정을 확인해주세요.');
    return { enabled: config.enabled, time: config.time, timeZone: 'Asia/Seoul' };
  }
  async write(name, value) {
    await writeFile(`${this.file(name)}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(`${this.file(name)}.tmp`, this.file(name));
  }
  async configure(config) { const validated = this.validateConfig(config); await this.write('daily-config.json', validated); this.config = validated; return this.status(); }
  status() {
    const last = this.history.at(-1);
    const job = last?.jobId ? this.controller.records.get(last.jobId) : null;
    return { ...this.config, last: last ? { ...last, jobStatus: job?.status, prUrl: job?.prUrl, previewUrl: job?.previewUrl } : null };
  }
  run({ previewOnly = false } = {}) {
    const work = this.chain.catch(() => {}).then(() => this.execute(previewOnly)); this.chain = work; return work;
  }
  async execute(previewOnly) {
    const day = seoulDay(this.now()); const plan = dailyPlan(this.controller);
    if (previewOnly) return { state: 'preview', day, enabled: this.config.enabled, ...plan };
    if (!this.config.enabled) return { state: 'disabled', day };
    const previous = this.history.find(r => r.day === day);
    if (previous) return { ...previous, state: 'already-checked', previousState: previous.state, daily: this.status() };
    const run = { day, at: this.now().toISOString(), state: 'preparing', ids: plan.ids, remaining: plan.remaining, insufficient: plan.insufficient };
    this.history.push(run); this.history = this.history.slice(-90);
    // Persist the once-per-day reservation before invoking the existing pipeline.
    await this.write('daily-runs.json', { schemaVersion: 1, runs: this.history });
    try {
      if (plan.busy || plan.blockers.length) { run.state = 'deferred'; run.blockers = plan.blockers; }
      else {
        for (const skipped of plan.insufficient) {
          const record = this.controller.get(skipped.id);
          if (record.status !== 'received' || record.autoProcessExcluded || !this.controller.view(record).canRequestFix) continue;
          record.status = 'insufficient-evidence'; record.error = skipped.reason;
          record.audit.push({ at: this.now().toISOString(), action: 'daily-insufficient-evidence', day }); await this.controller.save(record);
        }
        if (!plan.ids.length) run.state = plan.insufficient.length ? 'needs-evidence' : 'empty';
        else {
          const readiness = await this.controller.readiness();
          if (!readiness.codex || !readiness.previewWorkflow || !readiness.releaseApproval) throw new Error('자동 수정 로그인·Windows 검사·배포 승인 설정을 확인해주세요.');
          // Recheck after asynchronous readiness checks; manual actions may have begun.
          const current = dailyPlan(this.controller);
          if (current.busy || current.blockers.length || plan.ids.some(id => !current.ids.includes(id))) throw new Error('접수 또는 진행 중인 수정안이 바뀌었습니다. 다음 일일 실행에서 다시 확인합니다.');
          const actor = `daily:${day}`; const metadata = { dailyRunDate: day, dailyRemaining: plan.remaining };
          const job = plan.ids.length === 1 ? await this.controller.startFix(plan.ids[0], actor, metadata)
            : await this.controller.startBatch(plan.ids, actor, metadata);
          run.state = 'started'; run.jobId = job.id;
        }
      }
    } catch (error) { run.state = 'failed'; run.error = this.controller.safeError(error); }
    await this.write('daily-runs.json', { schemaVersion: 1, runs: this.history });
    return { ...run, daily: this.status() };
  }
}
