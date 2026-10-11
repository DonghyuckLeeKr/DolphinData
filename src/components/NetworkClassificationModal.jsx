import React, { memo, useEffect, useRef, useState } from 'react';
import { Check, Database, EyeOff, Infinity as InfinityIcon, Wifi, X } from 'lucide-react';
import { getNetworkDisplayInfo } from '../utils/networkDisplay';

const MODES = [
  {
    value: 'metered',
    label: '데이터 요금제에 누적',
    description: '이 네트워크의 송수신량을 선택한 요금제에서 차감합니다.',
    Icon: Database
  },
  {
    value: 'unmetered',
    label: '무제한 네트워크',
    description: '집·회사 Wi-Fi처럼 속도만 표시하고 사용량은 누적하지 않습니다.',
    Icon: InfinityIcon
  },
  {
    value: 'ignored',
    label: '측정 제외',
    description: '이 네트워크는 사용량 기록에서 제외합니다.',
    Icon: EyeOff
  }
];

function NetworkClassificationModal({ binding, profiles, onSave, onClose, onSaved }) {
  const [meteringMode, setMeteringMode] = useState('metered');
  const [profileId, setProfileId] = useState(() => {
    const confirmed = (profiles || []).find(p => !p.needsRegistration && p.id === binding?.profileId)
      || (profiles || []).find(p => !p.needsRegistration);
    if (confirmed) return confirmed.id;
    return binding?.profileId || profiles?.[0]?.id || '';
  });
  const dialogRef = useRef(null);
  const display = getNetworkDisplayInfo(binding || {});

  useEffect(() => {
    const previousFocus = document.activeElement;
    const getFocusableElements = () => Array.from(dialogRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    ) || []);
    const initialControl = dialogRef.current?.querySelector('input[name="meteringMode"]');
    (initialControl || getFocusableElements()[0])?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'Tab') {
        const focusableElements = getFocusableElements();
        if (focusableElements.length === 0) return;
        const first = focusableElements[0];
        const last = focusableElements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, [onClose]);

  if (!binding) return null;

  const handleSubmit = (event) => {
    event.preventDefault();
    if (meteringMode === 'metered' && !profileId) return;
    onSave({
      fingerprint: binding.fingerprint,
      meteringMode,
      profileId: meteringMode === 'metered' ? profileId : ''
    });
    onSaved();
  };

  return (
    <div
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '18px',
        background: 'rgba(5, 10, 24, 0.84)'
      }}
    >
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="network-classification-title"
        onSubmit={handleSubmit}
        style={{
          width: '100%',
          maxWidth: '500px',
          padding: '24px',
          borderRadius: '18px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--brand-color)',
          boxShadow: '0 24px 70px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '13px', background: 'var(--brand-badge-bg)', border: '1px solid var(--brand-badge-border)', color: 'var(--brand-color)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Wifi size={21} />
            </div>
            <div>
              <h2 id="network-classification-title" style={{ margin: 0, color: 'var(--text-main)', fontSize: '1.08rem' }}>네트워크 사용 방식을 확인해 주세요</h2>
              <p style={{ margin: '3px 0 0', color: 'var(--text-muted)', fontSize: '0.76rem' }}>현재 연결을 어떤 요금제에 연결할지 선택해 주세요.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="나중에 설정" style={{ width: '44px', height: '44px', border: 0, borderRadius: '10px', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '11px 13px', borderRadius: '11px', background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)' }}>
          <b style={{ color: 'var(--text-main)', fontSize: '0.86rem' }}>{binding.networkName || '알 수 없는 네트워크'}</b>
          <span style={{ color: 'var(--accent-blue)', fontSize: '0.72rem', marginLeft: '8px' }}>{display.label}</span>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem', marginTop: '3px' }}>물리 어댑터: {binding.interfaceName || '확인 중'}</div>
        </div>

        <fieldset style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: '8px' }}>
          <legend style={{ color: 'var(--text-main)', fontSize: '0.8rem', fontWeight: 700, marginBottom: '7px' }}>이 네트워크는 어떻게 사용할까요?</legend>
          {MODES.map(({ value, label, description, Icon }) => {
            const selected = meteringMode === value;
            return (
              <label key={value} style={{ display: 'flex', gap: '10px', alignItems: 'center', padding: '10px 12px', borderRadius: '11px', border: `1px solid ${selected ? 'var(--brand-color)' : 'var(--glass-border-light)'}`, background: selected ? 'var(--brand-badge-bg)' : 'var(--glass-card)', cursor: 'pointer' }}>
                <input type="radio" name="meteringMode" value={value} checked={selected} onChange={() => setMeteringMode(value)} style={{ accentColor: 'var(--brand-color)' }} />
                <Icon size={17} color={selected ? 'var(--brand-color)' : 'var(--text-muted)'} />
                <span>
                  <b style={{ display: 'block', color: 'var(--text-main)', fontSize: '0.8rem' }}>{label}</b>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>{description}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        {meteringMode === 'metered' && (
          <div>
            <label htmlFor="new-network-profile" style={{ display: 'block', color: 'var(--text-main)', fontSize: '0.79rem', fontWeight: 700, marginBottom: '6px' }}>누적할 요금제</label>
            <select id="new-network-profile" className="glass-input" value={profileId} onChange={(event) => setProfileId(event.target.value)} required style={{ width: '100%', color: 'var(--text-main)', cursor: 'pointer' }}>
              {(profiles || []).map(profile => (
                <option key={profile.id} value={profile.id} style={{ background: 'var(--bg-primary)' }}>{profile.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '9px', paddingTop: '4px' }}>
          <button type="button" onClick={onClose} className="glass-btn" style={{ cursor: 'pointer', minHeight: '44px' }}>나중에</button>
          <button type="submit" className="glass-btn glass-btn-primary" style={{ cursor: 'pointer', minHeight: '44px' }}>
            <Check size={16} />
            <span>이대로 사용</span>
          </button>
        </div>
      </form>
    </div>
  );
}

export default memo(NetworkClassificationModal);
