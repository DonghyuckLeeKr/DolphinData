import React, { memo, useEffect, useRef } from 'react';
import { ArrowRight, CheckCircle2, Download, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react';
import { getKoreanUpdateNotes } from '../utils/updatePresentation';

function UpdateModal({ update, status, error, onInstall, onClose }) {
  const dialogRef = useRef(null);
  const busy = status === 'installing' || status === 'restarting';
  const latestVersion = update?.manifest?.version || '최신';
  const currentVersion = update?.currentVersion || '-';
  const notes = getKoreanUpdateNotes(update?.manifest?.body);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const primaryButton = dialogRef.current?.querySelector('[data-primary-action]');
    primaryButton?.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(dialogRef.current?.querySelectorAll('button:not([disabled])') || []);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [busy, onClose]);

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 12000,
        display: 'grid',
        placeItems: 'center',
        padding: '20px',
        background: 'rgba(3, 8, 20, 0.82)',
        backdropFilter: 'blur(10px)'
      }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        aria-describedby="update-modal-description"
        style={{
          width: 'min(520px, 100%)',
          overflow: 'hidden',
          borderRadius: '22px',
          border: '1px solid var(--brand-badge-border)',
          background: 'linear-gradient(155deg, var(--bg-primary) 0%, var(--glass-bg) 100%)',
          boxShadow: '0 30px 90px rgba(0, 0, 0, 0.65), 0 0 40px rgba(14, 165, 233, 0.12)'
        }}
      >
        <div style={{ position: 'relative', padding: '26px 26px 21px', borderBottom: '1px solid var(--glass-border-light)' }}>
          <div style={{ position: 'absolute', width: '180px', height: '180px', top: '-105px', right: '-55px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(56, 189, 248, 0.25), transparent 68%)', pointerEvents: 'none' }} />
          {!busy && (
            <button type="button" onClick={onClose} aria-label="업데이트 창 닫기" style={{ position: 'absolute', top: '16px', right: '16px', width: '40px', height: '40px', display: 'grid', placeItems: 'center', border: 0, borderRadius: '11px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}>
              <X size={20} />
            </button>
          )}

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingRight: '42px' }}>
            <div style={{ position: 'relative', flex: '0 0 auto', width: '54px', height: '54px', display: 'grid', placeItems: 'center', borderRadius: '17px', background: 'var(--brand-gradient)', boxShadow: '0 12px 30px rgba(14, 165, 233, 0.28)' }}>
              <img src="/icon.png" alt="" aria-hidden="true" style={{ width: '46px', height: '46px', borderRadius: '14px', objectFit: 'cover' }} />
              <span style={{ position: 'absolute', right: '-3px', bottom: '-3px', width: '18px', height: '18px', display: 'grid', placeItems: 'center', borderRadius: '50%', color: '#052e2b', background: 'var(--accent-emerald)', border: '3px solid var(--bg-primary)' }}>
                <CheckCircle2 size={11} strokeWidth={3} />
              </span>
            </div>
            <div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', marginBottom: '5px', padding: '3px 8px', borderRadius: '999px', color: 'var(--brand-color)', background: 'var(--brand-badge-bg)', border: '1px solid var(--brand-badge-border)', fontSize: '0.68rem', fontWeight: 800 }}>
                <span>새 버전</span>
              </div>
              <h2 id="update-modal-title" style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.25rem', lineHeight: 1.35 }}>새로운 돌핀 데이터가 도착했어요</h2>
              <p id="update-modal-description" style={{ margin: '5px 0 0', color: 'var(--text-muted)', fontSize: '0.78rem' }}>더 안정적이고 편리해진 최신 버전을 설치할 수 있습니다.</p>
            </div>
          </div>
        </div>

        <div style={{ padding: '20px 26px 24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '13px', padding: '14px', borderRadius: '14px', background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem', fontWeight: 700 }}>v{currentVersion}</span>
            <ArrowRight size={17} color="var(--brand-color)" />
            <span style={{ color: 'var(--text-main)', fontSize: '1rem', fontWeight: 900 }}>v{latestVersion}</span>
          </div>

          <div style={{ marginTop: '16px', padding: '15px 16px', borderRadius: '14px', background: 'rgba(14, 165, 233, 0.08)', border: '1px solid var(--glass-border-light)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '7px', color: 'var(--text-main)', fontSize: '0.78rem', fontWeight: 800 }}>
              <Sparkles size={15} color="var(--brand-color)" />
              <span>이번 업데이트 내용</span>
            </div>
            <p style={{ margin: 0, maxHeight: '190px', overflowY: 'auto', color: 'var(--text-main)', fontSize: '0.78rem', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{notes}</p>
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '9px', marginTop: '14px', color: 'var(--text-muted)', fontSize: '0.7rem', lineHeight: 1.55 }}>
            <ShieldCheck size={17} color="var(--accent-emerald)" style={{ flex: '0 0 auto', marginTop: '1px' }} />
            <span>검증된 업데이트 파일을 안전하게 설치합니다. 설치가 끝나면 앱이 자동으로 다시 시작됩니다.</span>
          </div>

          {error && (
            <div role="alert" style={{ marginTop: '14px', padding: '10px 12px', borderRadius: '11px', color: '#fecdd3', background: 'rgba(244, 63, 94, 0.13)', border: '1px solid rgba(244, 63, 94, 0.3)', fontSize: '0.73rem', lineHeight: 1.5 }}>
              업데이트를 설치하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '9px', marginTop: '20px' }}>
            {!busy && <button type="button" onClick={onClose} className="glass-btn" style={{ minHeight: '44px', paddingInline: '17px' }}>나중에</button>}
            <button data-primary-action type="button" onClick={onInstall} disabled={busy} className="glass-btn glass-btn-primary" style={{ minWidth: '166px', minHeight: '44px', justifyContent: 'center', opacity: busy ? 0.82 : 1 }}>
              {busy ? <RefreshCw size={17} className="update-spin" /> : <Download size={17} />}
              <span>{status === 'installing' ? '다운로드 및 설치 중...' : status === 'restarting' ? '다시 시작하는 중...' : error ? '다시 시도' : '지금 업데이트'}</span>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default memo(UpdateModal);
