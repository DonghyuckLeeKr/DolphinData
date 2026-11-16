import React, { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Cpu, MemoryStick, RefreshCw, ShieldCheck, TriangleAlert, XCircle } from 'lucide-react';
import { fetchTopProcesses, isRunningAsAdmin, isTauriAvailable, terminateProcess } from '../services/networkTelemetry';
import { formatBytes } from '../utils/formatters';
import { resolveProcessSortMode, sortProcessesForDisplay } from '../utils/processDisplay';

export default function AppBreakdownCard({ onRunAsAdmin }) {
  const [processes, setProcesses] = useState([]);
  const [runningAsAdmin, setRunningAsAdmin] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  const [relaunchError, setRelaunchError] = useState('');

  useEffect(() => {
    let mounted = true;
    isRunningAsAdmin()
      .then(elevated => { if (mounted) setRunningAsAdmin(Boolean(elevated)); })
      .catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Offer the relaunch right where the missing data is, instead of sending users to settings.
  const handleRelaunch = async () => {
    if (!onRunAsAdmin || relaunching) return;
    setRelaunchError('');
    setRelaunching(true);
    try {
      await onRunAsAdmin();
    } catch (error) {
      setRelaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setRelaunching(false);
    }
  };
  const [source, setSource] = useState('starting');
  const [collectionError, setCollectionError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState('network');

  const loadProcesses = useCallback(async () => {
    setLoading(true);
    try {
      const snapshot = await fetchTopProcesses();
      setProcesses(Array.isArray(snapshot?.processes) ? snapshot.processes : []);
      setSource(snapshot?.source || 'unavailable');
      setCollectionError(snapshot?.error || null);
    } catch (error) {
      console.warn('Process load error', error);
      setProcesses([]);
      setSource('unavailable');
      setCollectionError('프로세스별 네트워크 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProcesses();
    const interval = setInterval(loadProcesses, 2000);
    return () => clearInterval(interval);
  }, [loadProcesses]);

  const handleKill = async (pid, name) => {
    if (!window.confirm(`프로세스 '${name}' (PID: ${pid})을(를) 종료할까요? 저장하지 않은 작업은 사라질 수 있습니다.`)) return;
    const success = await terminateProcess(pid);
    if (success) setProcesses(prev => prev.filter(process => process.pid !== pid));
  };

  const isEtw = source === 'etw';
  const activeSortMode = resolveProcessSortMode(source, sortMode);
  const sortedProcesses = sortProcessesForDisplay(processes, source, sortMode);

  return (
    <div className="glass-card" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-main)' }}>
              {isEtw ? '프로그램별 데이터 사용량' : '실행 중인 프로그램'}
            </h3>
            <span style={{
              fontSize: '0.7rem', fontWeight: '700', padding: '2px 8px', borderRadius: '12px',
              background: isEtw ? 'rgba(52, 211, 153, 0.15)' : 'rgba(251, 191, 36, 0.12)',
              color: isEtw ? 'var(--accent-emerald)' : '#fbbf24',
              border: `1px solid ${isEtw ? 'rgba(52, 211, 153, 0.3)' : 'rgba(251, 191, 36, 0.3)'}`,
              display: 'flex', alignItems: 'center', gap: '4px'
            }}>
              {isEtw ? <CheckCircle2 size={11} /> : <TriangleAlert size={11} />}
              {isEtw ? '실제 데이터 사용량' : 'CPU와 메모리로 표시 중'}
            </span>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>
            {isEtw
              ? '프로그램마다 받고 보낸 데이터를 보여 줍니다. CPU와 메모리는 참고용입니다.'
              : '프로그램별 데이터는 관리자 권한에서만 볼 수 있어, 지금은 CPU와 메모리 순으로 보여 줍니다.'}
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          {isEtw ? (
            <>
              <button onClick={() => setSortMode('network')} className="glass-btn" style={{ padding: '4px 8px', fontSize: '0.72rem', color: activeSortMode === 'network' ? 'var(--brand-color)' : undefined }}>
                지금 속도순
              </button>
              <button onClick={() => setSortMode('session')} className="glass-btn" style={{ padding: '4px 8px', fontSize: '0.72rem', color: activeSortMode === 'session' ? 'var(--brand-color)' : undefined }}>
                누적순
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setSortMode('cpu')} className="glass-btn" style={{ padding: '4px 8px', fontSize: '0.72rem', color: activeSortMode === 'cpu' ? 'var(--brand-color)' : undefined }}>
                CPU순
              </button>
              <button onClick={() => setSortMode('memory')} className="glass-btn" style={{ padding: '4px 8px', fontSize: '0.72rem', color: activeSortMode === 'memory' ? 'var(--brand-color)' : undefined }}>
                메모리순
              </button>
            </>
          )}
          <button onClick={loadProcesses} className="glass-btn" style={{ padding: '4px 8px' }} title="프로세스 새로고침">
            <RefreshCw size={13} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {!isEtw && source !== 'starting' && (
        <div style={{
          padding: '10px 12px', borderRadius: '9px', fontSize: '0.74rem', color: '#fbbf24',
          background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.24)'
        }}>
          <div style={{ fontWeight: '700' }}>
            {collectionError || '프로그램별 데이터 사용량은 관리자 권한에서만 볼 수 있습니다.'}
          </div>
          {!runningAsAdmin && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
              <button
                type="button"
                className="glass-btn"
                onClick={handleRelaunch}
                disabled={!onRunAsAdmin || !isTauriAvailable() || relaunching}
                style={{ padding: '6px 12px', fontSize: '0.76rem', color: 'var(--text-main)', cursor: relaunching ? 'default' : 'pointer' }}
              >
                <ShieldCheck size={14} />
                <span>{relaunching ? 'Windows 권한 확인 대기 중…' : '관리자 권한으로 다시 실행'}</span>
              </button>
              <span style={{ color: 'var(--text-muted)', lineHeight: '1.45' }}>Windows에서 허용하면 앱이 다시 열리고 바로 보입니다.</span>
            </div>
          )}
          {relaunchError && <div role="alert" style={{ marginTop: '6px', color: 'var(--accent-rose)' }}>{relaunchError}</div>}
        </div>
      )}

      {sortedProcesses.length === 0 ? (
        <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          데스크톱 앱에서 실행하면 프로그램 목록이 나옵니다.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {sortedProcesses.slice(0, 6).map(process => (
            <div key={process.pid} style={{
              background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)',
              borderRadius: '10px', padding: '10px 14px', display: 'flex', alignItems: 'center', gap: '12px'
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {process.name}
                </div>
                <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <span>PID {process.pid}</span>
                  {isEtw && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}><Cpu size={10} /> {process.cpuPercent.toFixed(1)}%</span>}
                  {isEtw && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '2px' }}><MemoryStick size={10} /> {formatBytes(process.memoryBytes)}</span>}
                </div>
              </div>
              {isEtw ? (
                <>
                  <div style={{ textAlign: 'right', minWidth: '94px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', fontSize: '0.68rem', color: 'var(--accent-blue)' }}><ArrowDown size={11} /> 다운로드</span>
                    <b style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>{formatBytes(process.downloadBytesPerSec)}/s</b>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '94px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', fontSize: '0.68rem', color: 'var(--accent-violet)' }}><ArrowUp size={11} /> 업로드</span>
                    <b style={{ fontSize: '0.88rem', color: 'var(--text-main)' }}>{formatBytes(process.uploadBytesPerSec)}/s</b>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '86px' }}>
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>실행 후 누적</span>
                    <b style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-main)' }}>{formatBytes(process.sessionDownloadBytes + process.sessionUploadBytes)}</b>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ textAlign: 'right', minWidth: '86px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', fontSize: '0.68rem', color: 'var(--accent-blue)' }}><Cpu size={11} /> CPU</span>
                    <b style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{process.cpuPercent.toFixed(1)}%</b>
                  </div>
                  <div style={{ textAlign: 'right', minWidth: '96px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '3px', fontSize: '0.68rem', color: 'var(--accent-violet)' }}><MemoryStick size={11} /> 메모리</span>
                    <b style={{ fontSize: '0.9rem', color: 'var(--text-main)' }}>{formatBytes(process.memoryBytes)}</b>
                  </div>
                </>
              )}
              <button onClick={() => handleKill(process.pid, process.name)} style={{
                background: 'rgba(244, 63, 94, 0.12)', border: '1px solid rgba(244, 63, 94, 0.3)',
                color: 'var(--accent-rose)', padding: '4px 8px', borderRadius: '6px', cursor: 'pointer',
                display: 'flex', alignItems: 'center', gap: '3px', fontSize: '0.7rem', fontWeight: '700'
              }} title="이 프로세스 강제 종료">
                <XCircle size={12} /> 종료
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
