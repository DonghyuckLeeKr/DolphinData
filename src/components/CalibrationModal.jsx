import React, { useState, memo, useId, useRef } from 'react';
import useModalA11y from '../hooks/useModalA11y';
import { X, Check, Edit3, RefreshCw, Radio, Sparkles } from 'lucide-react';
import { detectLteRouterCarrier } from '../services/routerDetectionService';
import { getBillingPeriod } from '../services/storageService';

function CalibrationModal({ profile, networkBindings = [], onSave, onClose }) {
  const dialogRef = useRef(null);
  const titleId = useId();
  useModalA11y(dialogRef, onClose);
  const [carrierInput, setCarrierInput] = useState(profile.carrierName || profile.name || '모바일 데이터 요금제');
  const [baselineInput, setBaselineInput] = useState(
    profile.initialBaselineGB !== undefined ? String(profile.initialBaselineGB) : '0'
  );
  const [limitInput, setLimitInput] = useState(
    profile.monthlyLimitGB !== undefined ? String(profile.monthlyLimitGB) : '100'
  );
  const [resetDayInput, setResetDayInput] = useState(
    profile.resetDay !== undefined ? String(profile.resetDay) : '1'
  );
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null);

  const handleAutoDetect = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const result = await detectLteRouterCarrier();
      setScanResult(result);
      if (result.detected && result.carrierName) {
        setCarrierInput(result.carrierName);
      }
    } catch (error) {
      setScanResult({
        detected: false,
        message: error instanceof Error ? error.message : '라우터 검색 중 오류가 발생했습니다.'
      });
    } finally {
      setScanning(false);
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    const parsedBaseline = parseFloat(baselineInput) || 0;
    const parsedLimit = parseFloat(limitInput) || 100;
    const parsedResetDay = Math.min(31, Math.max(1, parseInt(resetDayInput, 10) || 1));

    const previousBaseline = parseFloat(profile.initialBaselineGB) || 0;
    const baselineChanged = Math.abs(parsedBaseline - previousBaseline) > 0.001;

    const saveData = {
      name: carrierInput.trim() || profile.name,
      carrierName: carrierInput.trim() || '데이터 요금제',
      initialBaselineGB: Math.max(0, parsedBaseline),
      monthlyLimitGB: Math.max(1, parsedLimit),
      resetDay: parsedResetDay,
      lastResetPeriod: getBillingPeriod(parsedResetDay),
      needsRegistration: false
    };

    // Only reset sessionBytes when user actually changed the baseline calibration value
    // This prevents wiping accumulated real-time traffic when editing name/limit/resetDay
    if (baselineChanged) {
      saveData.sessionBytes = 0;
    }

    onSave(saveData);
    onClose();
  };

  const handleQuickZeroReset = () => {
    if (window.confirm('정말로 이 프로필의 사용량을 0 GB로 완전히 초기화하시겠습니까?')) {
      const resetDay = profile.resetDay || 1;
      setBaselineInput('0');
      onSave({
        initialBaselineGB: 0,
        sessionBytes: 0,
        lastResetPeriod: getBillingPeriod(resetDay)
      });
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(5, 10, 24, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '16px'
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '520px',
          padding: '26px',
          position: 'relative',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'var(--bg-primary)',
          borderRadius: '16px',
          border: '1px solid var(--glass-border)',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.7)'
        }}
      >
        
        {/* Close Button */}
        <button
          aria-label="닫기"
          onClick={onClose}
          type="button"
          style={{
            position: 'absolute',
            top: '18px',
            right: '18px',
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '4px'
          }}
        >
          <X size={20} />
        </button>

        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
          <div style={{
            width: '38px',
            height: '38px',
            borderRadius: '10px',
            background: 'var(--brand-badge-bg)',
            border: '1px solid var(--brand-badge-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--brand-color)'
          }}>
            <Edit3 size={20} />
          </div>
          <div>
            <h2 id={titleId} style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)' }}>
              '{profile.name || '요금제'}' 사용량 보정 & 라우터 검색
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              통신사 이름, 월간 한도, 현재 사용량을 직접 설정합니다.
            </p>
          </div>
        </div>

        {/* Scan Result Notification */}
        {scanResult && (
          <div style={{
            background: scanResult.detected ? 'rgba(52, 211, 153, 0.1)' : 'rgba(244, 63, 94, 0.1)',
            border: `1px solid ${scanResult.detected ? 'rgba(52, 211, 153, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
            borderRadius: '10px',
            padding: '10px 14px',
            marginBottom: '14px',
            fontSize: '0.78rem',
            color: 'var(--text-main)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}>
            <Radio size={16} color={scanResult.detected ? 'var(--accent-emerald)' : 'var(--accent-rose)'} />
            <div>
              <b>{scanResult.detected ? '네트워크 게이트웨이 응답 확인' : '게이트웨이를 찾지 못했습니다'}</b><br />
              {scanResult.detected && <>게이트웨이: <code>{scanResult.gatewayIp}</code><br /></>}
              {scanResult.message}
            </div>
          </div>
        )}

        <form onSubmit={handleFormSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {networkBindings.length > 0 && (
            <div style={{
              padding: '10px 12px',
              borderRadius: '10px',
              background: 'rgba(14, 165, 233, 0.08)',
              border: '1px solid rgba(14, 165, 233, 0.22)',
              color: 'var(--text-muted)',
              fontSize: '0.75rem',
              lineHeight: 1.55
            }}>
              연결된 네트워크: <b style={{ color: 'var(--text-main)' }}>
                {networkBindings.map(binding => binding.networkName || binding.interfaceName).filter(Boolean).join(', ')}
              </b><br />
              네트워크 연결 변경은 환경 설정에서 관리합니다.
            </div>
          )}
          
          {/* Carrier Name Input with Auto-Detect Button */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
              <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)' }}>
                요금제 / 회선 이름
              </label>

              <button
                type="button"
                onClick={handleAutoDetect}
                disabled={scanning}
                className="glass-btn"
                style={{
                  padding: '3px 8px',
                  fontSize: '0.72rem',
                  borderColor: 'var(--brand-color)',
                  color: 'var(--brand-color)',
                  cursor: 'pointer'
                }}
              >
                {scanning ? <RefreshCw size={12} className="spin" /> : <Sparkles size={12} />}
                <span>{scanning ? '라우터 조회 중...' : '라우터 검색'}</span>
              </button>
            </div>

            <input
              type="text"
              value={carrierInput}
              onChange={(e) => setCarrierInput(e.target.value)}
              className="glass-input"
              placeholder="예: 스마트폰 테더링 20GB, 모바일 라우터 80GB 등"
              required
            />
          </div>

          {/* Baseline Input */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              현재까지 사용한 데이터 수치 (GB 단위)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                step="0.01"
                min="0"
                max="2000"
                value={baselineInput}
                onChange={(e) => setBaselineInput(e.target.value)}
                className="glass-input"
                placeholder="예: 34.5"
                required
              />
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>GB</span>
            </div>
          </div>

          {/* Monthly Limit Input */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              월간 데이터 총 한도 (GB)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                step="1"
                min="1"
                max="5000"
                value={limitInput}
                onChange={(e) => setLimitInput(e.target.value)}
                className="glass-input"
                placeholder="100"
                required
              />
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>GB</span>
            </div>
          </div>

          {/* Reset Day Selector */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              매월 자동 초기화(리셋) 일자
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                step="1"
                min="1"
                max="31"
                value={resetDayInput}
                onChange={(e) => setResetDayInput(e.target.value)}
                className="glass-input"
                placeholder="1"
                required
              />
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>일</span>
            </div>
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
              기본값: <b>매월 1일</b> 00:00시 자동 0 GB 초기화
            </span>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '6px', paddingTop: '14px', borderTop: '1px solid var(--glass-border)' }}>
            <button
              type="button"
              onClick={handleQuickZeroReset}
              style={{
                background: 'rgba(244, 63, 94, 0.12)',
                border: '1px solid rgba(244, 63, 94, 0.3)',
                color: 'var(--accent-rose)',
                padding: '8px 12px',
                borderRadius: '8px',
                fontSize: '0.75rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                fontWeight: '600'
              }}
            >
              <RefreshCw size={13} />
              <span>0 GB 초기화</span>
            </button>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="button" onClick={onClose} className="glass-btn" style={{ cursor: 'pointer' }}>
                취소
              </button>
              <button type="submit" className="glass-btn glass-btn-primary" style={{ cursor: 'pointer' }}>
                <Check size={16} />
                <span>보정 저장하기</span>
              </button>
            </div>
          </div>

        </form>

      </div>
    </div>
  );
}

export default memo(CalibrationModal);
