import React, { useEffect, useRef, useState } from 'react';
import { diagnosticRecorder, SYMPTOMS } from '../services/diagnosticService.js';
import { getInstalledAppVersion } from '../services/updateService.js';
import { fetchDiagnosticEnvironment, isTauriAvailable } from '../services/networkTelemetry.js';

export default function DiagnosticPanel({ config, admin }) {
  const [status, setStatus] = useState(diagnosticRecorder.status());
  const [symptom, setSymptom] = useState('same-router-reconnect');
  const [description, setDescription] = useState('');
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const configRef = useRef(config);
  configRef.current = config;
  useEffect(() => { const timer = setInterval(() => setStatus(diagnosticRecorder.status()), 1000); return () => clearInterval(timer); }, []);
  const start = async () => {
    setStarting(true);
    try {
      const [appVersion, environment] = await Promise.all([getInstalledAppVersion().catch(() => '0.0.0'), fetchDiagnosticEnvironment().catch(() => ({}))]);
      diagnosticRecorder.start(configRef.current, { ...environment, appVersion, platform: isTauriAvailable() ? 'windows' : 'preview', admin });
      setPreview(''); setError(''); setStatus(diagnosticRecorder.status());
    } catch (e) { setError(e.message); } finally { setStarting(false); }
  };
  const review = () => {
    try { diagnosticRecorder.stop(); setStatus(diagnosticRecorder.status()); setPreview(JSON.stringify(diagnosticRecorder.export({ symptom, description }), null, 2)); setError(''); }
    catch (e) { setError(e.message); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([preview], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `DolphinData-diagnostic-${JSON.parse(preview).reportId}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section aria-label="문제 진단" style={{ display: 'grid', gap: 8 }}>
    <strong style={{ fontSize: '0.82rem' }}>문제 진단 리포트</strong>
    <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0 }}>기록을 시작한 뒤 문제가 발생하는 동작을 다시 해주세요. 최대 240개 상태와 Windows·설치된 USB 네트워크 드라이버 버전을 기록합니다. 장치·네트워크 이름과 주소는 별칭으로 바꾸며, 사용량은 유무만 포함합니다. 파일을 직접 전달하기 전에는 외부로 전송되지 않습니다.</p>
    <select aria-label="문제 종류" value={symptom} onChange={e => { setSymptom(e.target.value); setPreview(''); }}>{Object.entries(SYMPTOMS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
    <textarea aria-label="문제 설명" placeholder="문제가 발생한 동작과 기대한 결과 (개인정보 제외)" value={description} maxLength={1000} onChange={e => { setDescription(e.target.value); setPreview(''); }} rows={3} />
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button type="button" className="glass-btn" onClick={start} disabled={status.recording || starting}>{starting ? '환경 정보 확인 중…' : '진단 기록 시작'}</button>
      <button type="button" className="glass-btn" onClick={review} disabled={!status.available}>기록 종료 및 내용 확인</button>
    </div>
    <span role="status" style={{ fontSize: '0.75rem' }}>{status.recording ? '기록 중' : '기록 정지'} · {status.eventCount}개{status.truncated ? ' · 기록 한도 도달, 다시 기록해주세요' : ''}</span>
    {error && <span role="alert">{error}</span>}
    {preview && <><p style={{ fontSize: '0.75rem', margin: 0 }}>설명에 개인정보가 남아 있는지 확인한 뒤 파일을 개발자에게 전달해주세요. 설정 백업 파일과는 다른 형식입니다.</p><pre style={{ maxHeight: 180, overflow: 'auto', fontSize: '0.65rem', whiteSpace: 'pre-wrap' }}>{preview}</pre><button type="button" className="glass-btn" onClick={download}>확인한 진단 리포트 다운로드</button></>}
  </section>;
}
