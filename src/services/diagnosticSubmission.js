import { diagnosticRecorder, parseDiagnosticReport, SYMPTOMS } from './diagnosticService.js';
import { getTauriInvoke, fetchDiagnosticEnvironment, isTauriAvailable } from './networkTelemetry.js';
import { getInstalledAppVersion } from './updateService.js';

const STORAGE_KEY = 'dolphindata-diagnostic-pending-v1';
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export function validateReceipt(value, report) {
  if (!value || value.reportId !== report.reportId || !uuid.test(value.receiptId) || !Number.isFinite(Date.parse(value.receivedAt))) {
    throw new Error('접수 결과를 확인하지 못했습니다. 다시 접수해주세요.');
  }
  return { reportId: value.reportId, receiptId: value.receiptId, receivedAt: value.receivedAt };
}

export async function getDiagnosticIntake() {
  const invoke = await getTauriInvoke();
  if (!invoke) throw new Error('자동 접수는 설치된 Windows 앱에서 사용할 수 있습니다.');
  return invoke('get_diagnostic_intake');
}
export async function sendDiagnosticReport(report) {
  const invoke = await getTauriInvoke();
  if (!invoke) throw new Error('자동 접수는 설치된 Windows 앱에서 사용할 수 있습니다.');
  return invoke('submit_diagnostic_report', { report: parseDiagnosticReport(report) });
}

// A single session outlives the settings modal. Persist only the anonymized,
// finished report so an interrupted request can be retried after app restart.
export function createDiagnosticSession({ recorder = diagnosticRecorder, storage = globalThis.localStorage,
  environment = fetchDiagnosticEnvironment, version = getInstalledAppVersion, send = sendDiagnosticReport,
  platform = () => isTauriAvailable() ? 'windows' : 'preview' } = {}) {
  let state = { phase: 'idle', symptom: 'same-router-reconnect', description: '', report: null, receipt: null, error: '' };
  try {
    const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null');
    if (saved?.report) {
      const report = parseDiagnosticReport(saved.report);
      const receipt = saved.receipt ? validateReceipt(saved.receipt, report) : null;
      state = { ...state, phase: receipt ? 'submitted' : 'stopped', report, receipt, symptom: report.symptom, description: report.description };
    }
  } catch { /* A corrupt diagnostic draft cannot change app settings. */ }
  const listeners = new Set();
  const change = partial => { state = { ...state, ...partial }; for (const listener of listeners) listener(); };
  const persist = (report, receipt) => storage?.setItem(STORAGE_KEY, JSON.stringify({ report, receipt }));
  return {
    getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    status: () => state.report ? { available: true, recording: false, eventCount: state.report.events.length, truncated: state.report.truncated,
      elapsedSeconds: Math.floor((state.report.events.at(-1)?.elapsedMs || 0) / 1000) } : recorder.status(),
    edit(partial) {
      if (state.report || ['preparing', 'submitting'].includes(state.phase)) return;
      change({ ...(Object.hasOwn(SYMPTOMS, partial.symptom) ? { symptom: partial.symptom } : {}),
        ...(typeof partial.description === 'string' ? { description: partial.description.slice(0, 1000) } : {}) });
    },
    async begin(config, admin = false) {
      if (recorder.status().recording || ['preparing', 'submitting'].includes(state.phase)) return;
      const previous = state.phase;
      change({ phase: 'preparing', error: '' });
      try {
        const [appVersion, info] = await Promise.all([version().catch(() => '0.0.0'), environment().catch(() => ({}))]);
        storage?.removeItem(STORAGE_KEY);
        recorder.start(config, { ...info, appVersion, platform: platform(), admin });
        change({ phase: 'recording', report: null, receipt: null, error: '' });
      } catch (error) { change({ phase: previous, error: error.message }); }
    },
    stop() { if (state.phase !== 'recording') return; recorder.stop(); change({ phase: 'stopped' }); },
    preview() { return state.report || recorder.export({ symptom: state.symptom, description: state.description }); },
    async submit() {
      if (['preparing', 'submitting', 'submitted'].includes(state.phase)) return;
      if (!state.report && !recorder.status().eventCount) { change({ error: '아직 기록된 상태가 없습니다. 기록 시작 후 문제가 발생하는 동작을 다시 해주세요.' }); return; }
      recorder.stop();
      let report;
      try {
        report = state.report || recorder.export({ symptom: state.symptom, description: state.description });
        persist(report, null);
      } catch { change({ phase: 'stopped', error: '리포트를 보관하지 못했습니다. 내용을 확인하고 백업 파일로 저장해주세요.' }); return; }
      change({ phase: 'submitting', report, error: '' });
      try {
        const receipt = validateReceipt(await send(report), report);
        // A receipt has already been confirmed. A storage failure must not
        // mislabel a successful intake as failure or trigger a second report.
        try { persist(report, receipt); } catch { /* Current-session receipt remains available. */ }
        change({ phase: 'submitted', receipt, error: '' });
      } catch (error) { change({ phase: 'stopped', error: error.message || '전송하지 못했습니다. 다시 접수해주세요.' }); }
    }
  };
}
export const diagnosticSession = createDiagnosticSession();
