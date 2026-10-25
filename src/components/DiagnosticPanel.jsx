import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { SYMPTOMS } from '../services/diagnosticService.js';
import { diagnosticSession, getDiagnosticIntake } from '../services/diagnosticSubmission.js';
import { SUPPORT_EMAIL } from '../utils/appMetadata.js';

const small = { fontSize: '0.78rem', lineHeight: 1.6, margin: 0 };
const field = { display: 'block', width: '100%', marginTop: 4, padding: 10, borderRadius: 8,
  background: 'var(--glass-bg)', color: 'var(--text-main)', border: '1px solid var(--glass-border)', fontSize: '0.8rem', lineHeight: 1.5 };
export default function DiagnosticPanel({ config, admin, session = diagnosticSession, intake = getDiagnosticIntake }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [status, setStatus] = useState(session.status());
  const [preview, setPreview] = useState('');
  const [destination, setDestination] = useState(null);
  useEffect(() => {
    setStatus(session.status());
    const timer = setInterval(() => setStatus(session.status()), 1000);
    return () => clearInterval(timer);
  }, [session, state]);
  useEffect(() => {
    let active = true;
    intake().then(result => { if (active) setDestination(result); }).catch(() => { if (active) setDestination({ mode: 'unavailable' }); });
    return () => { active = false; };
  }, [intake]);
  const busy = ['preparing', 'submitting'].includes(state.phase);
  const frozen = Boolean(state.report) || busy;
  const available = status.available;
  const minutes = Math.floor(status.elapsedSeconds / 60);
  const seconds = status.elapsedSeconds % 60;
  const review = () => { try { setPreview(JSON.stringify(session.preview(), null, 2)); } catch { setPreview(''); } };
  const download = () => {
    const report = session.preview();
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `DolphinData-diagnostic-${report.reportId}.json`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section aria-label="문제 진단" style={{ display: 'grid', gap: 12 }}>
    <p style={small}>1. 기록 시작 → 2. 문제가 발생하는 동작 재현 → 3. 문제 접수</p>
    <p style={{ ...small, color: 'var(--text-muted)' }}>기록은 직접 종료하거나 접수할 때 멈춥니다. 같은 상태는 반복 저장하지 않으며 최근 240개 상태를 보관합니다.</p>
    <label style={small}>문제 종류
      <select aria-label="문제 종류" style={field} value={state.symptom} disabled={frozen}
        onChange={event => { session.edit({ symptom: event.target.value }); setPreview(''); }}>
        {Object.entries(SYMPTOMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <label style={small}>문제 설명
      <textarea aria-label="문제 설명" style={{ ...field, resize: 'vertical' }}
        placeholder="어떤 동작을 했고, 어떤 문제가 나타났나요? 개인정보는 제외해주세요."
        value={state.description} disabled={frozen} maxLength={1000} rows={3}
        onChange={event => { session.edit({ description: event.target.value }); setPreview(''); }} />
    </label>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="glass-btn" disabled={status.recording || busy}
        onClick={() => { setPreview(''); void session.begin(config, admin); }}>{state.phase === 'preparing' ? '환경 정보 확인 중…' : available ? '새 진단 기록 시작' : '진단 기록 시작'}</button>
      {status.recording && <button type="button" className="glass-btn" onClick={() => session.stop()}>기록 종료</button>}
    </div>
    <span role="status" style={small}>{state.phase === 'preparing' ? '환경 정보를 확인하고 있습니다.'
      : status.recording ? `기록 중 · ${minutes}분 ${seconds}초 · ${status.eventCount}개 상태`
        : available ? `기록 종료 · ${status.eventCount}개 상태 보관` : '기록 대기 중'}</span>
    {status.truncated && <p style={{ ...small, color: 'var(--text-muted)' }}>기록은 계속되며 최근 240개 상태를 보관합니다. 오래된 상태 일부가 빠졌다는 표시를 리포트에 포함합니다.</p>}
    <p style={{ ...small, color: 'var(--text-muted)' }}>접수하면 네트워크 상태, Windows·USB 드라이버 버전, 위 설명을 개발자에게 전송합니다. 개발자가 자동 수정을 요청하면 AI가 설명과 기록을 분석합니다. 장치·네트워크 이름과 주소는 별칭으로 바꾸고 사용량은 유무만 포함합니다. 설명에 개인정보가 없는지 확인해주세요.</p>
    {destination?.mode === 'local' && <p style={small}>이 PC의 접수 서버에 연결되었습니다.</p>}
    {destination?.mode === 'public' && <p style={small}>개발자 접수 서버에 연결되었습니다.</p>}
    {destination?.mode === 'unavailable' && <p style={small}>접수 서버 연결을 확인하지 못했습니다. 접수 시 다시 연결하고, 실패하면 기록을 보관합니다.</p>}
    {state.error && <p role="alert" style={small}>{state.error}</p>}
    {state.receipt ? <div role="status" style={{ ...small, padding: 12, border: '1px solid var(--accent-emerald)', borderRadius: 8 }}>
      <strong>문제를 접수했습니다.</strong><br />접수 번호: {state.receipt.receiptId}<br />개발자가 리포트를 확인합니다. 추가 파일 전달은 필요하지 않습니다.
    </div> : <button type="button" className="glass-btn" style={{ minHeight: 42, color: 'var(--brand-color)', borderColor: 'var(--brand-color)' }}
      disabled={busy || !available || !status.eventCount} onClick={() => { setPreview(''); void session.submit(); }}>
      {state.phase === 'submitting' ? '문제 접수 중…' : state.report ? '다시 접수' : status.recording ? '기록 종료하고 문제 접수' : '문제 접수'}
    </button>}
    {available && <details style={small}>
      <summary style={{ cursor: 'pointer' }}>전송 내용 확인 및 백업</summary>
      <div style={{ display: 'grid', gap: 8, paddingTop: 8 }}>
        <button type="button" className="glass-btn" onClick={review} disabled={busy}>전송 내용 확인</button>
        {preview && <pre style={{ maxHeight: 180, overflow: 'auto', fontSize: '0.72rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{preview}</pre>}
        <button type="button" className="glass-btn" onClick={download} disabled={busy}>리포트 백업 파일 저장</button>
        <p style={small}>자동 접수가 계속 실패하면 이 JSON 파일을 <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('[DolphinData] 문제 진단 리포트')}`}>{SUPPORT_EMAIL}</a>로 첨부해 보내주세요. 파일 저장만으로 접수되지는 않습니다.</p>
      </div>
    </details>}
  </section>;
}
