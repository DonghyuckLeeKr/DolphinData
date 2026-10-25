import React, { useState, useSyncExternalStore } from 'react';
import { Settings, Monitor, Palette, Globe, ExternalLink, Calendar, LifeBuoy } from 'lucide-react';
import { diagnosticSession } from '../services/diagnosticSubmission.js';
import { openRouterAdminPage } from '../services/routerDetectionService';
import { getNetworkDisplayInfo } from '../utils/networkDisplay';

export default function Header({
  config,
  activeProfile,
  networkBinding,
  onOpenDailyHistory,
  onOpenSettings,
  onOpenReport,
  onToggleMiniGadget,
  onSelectTheme,
  telemetry
}) {
  const [routerOpenError, setRouterOpenError] = useState('');
  const diagnosticRecording = useSyncExternalStore(diagnosticSession.subscribe, diagnosticSession.getSnapshot).phase === 'recording';
  const currentTheme = config.theme || 'soft-dark';
  const networkDisplay = getNetworkDisplayInfo(networkBinding || {});
  const currentNetworkLabel = networkBinding
    ? `${networkDisplay.label} · ${networkBinding.networkName || networkBinding.interfaceName || '현재 네트워크'}`
    : '네트워크 확인 중';
  const mappedProfile = (config.profiles || []).find(profile => profile.id === networkBinding?.profileId);
  const mappingLabel = networkBinding?.meteringMode === 'metered' && mappedProfile
    ? `${mappedProfile.name}에 누적`
    : networkBinding?.meteringMode === 'unmetered'
      ? '무제한 · 누적 안 함'
      : networkBinding?.meteringMode === 'ignored'
        ? '측정 제외'
        : '분류 필요 · 누적 보류';
  const badgeLabel = networkBinding?.meteringMode === 'metered' && mappedProfile
    ? mappedProfile.name
    : networkBinding?.meteringMode === 'unmetered'
      ? '무제한 네트워크'
      : networkBinding?.meteringMode === 'ignored'
        ? '측정 제외'
        : networkBinding
          ? '정보 등록 필요'
          : activeProfile?.name || '메인 요금제';
  const telemetryLabel = telemetry?.source === 'native'
    ? '실시간 모니터링 중'
    : telemetry?.source === 'simulation'
      ? '브라우저 미리보기 · 사용량 저장 안 함'
      : telemetry?.source === 'error'
        ? '계측 오류 · 사용량 누적 중지'
        : '계측 준비 중';
  const handleOpenRouter = async () => {
    setRouterOpenError('');
    try {
      await openRouterAdminPage(networkBinding?.gatewayIp);
    } catch (error) {
      setRouterOpenError(error instanceof Error ? error.message : '라우터 페이지를 열지 못했습니다.');
    }
  };

  return (
    <header
      className="glass-panel"
      style={{
        padding: '12px 18px',
        marginBottom: '14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        position: 'relative',
        zIndex: 50
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
        
        {/* Left Branding */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: 'rgba(255, 255, 255, 0.06)',
            border: '1px solid var(--glass-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 14px rgba(0, 0, 0, 0.25)',
            pointerEvents: 'none',
            overflow: 'hidden'
          }}>
            <img src="/icon.png" alt="Dolphin Logo" style={{ width: '30px', height: '30px', objectFit: 'contain' }} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <h1 style={{ fontSize: '1.1rem', fontWeight: '700', letterSpacing: '-0.3px', margin: 0 }}>
                돌핀 데이터 <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 500 }}>(Dolphin Data)</span>
              </h1>
              <span className="lguplus-badge">{badgeLabel}</span>
            </div>
            <p style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span className="pulse-dot"></span>
              {currentNetworkLabel} → {mappingLabel} · {telemetryLabel}
            </p>
          </div>
        </div>

        {/* Right Action Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', position: 'relative', zIndex: 60 }}>
          
          {/* Compact Theme Dropdown Selector */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: 'var(--glass-card)',
              border: '1px solid var(--glass-border-light)',
              borderRadius: '10px',
              padding: '2px 8px 2px 10px'
            }}
          >
            <Palette size={14} color="var(--brand-color)" />
            <select
              value={currentTheme}
              onChange={(e) => onSelectTheme(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--text-main)',
                fontSize: '0.78rem',
                fontWeight: '600',
                outline: 'none',
                cursor: 'pointer',
                padding: '5px 0'
              }}
              title="테마 색상 변경"
            >
              <option value="soft-dark" style={{ background: '#0a1124', color: '#f1f5f9' }}>소프트 다크</option>
              <option value="midnight-black" style={{ background: '#07090e', color: '#f1f5f9' }}>미드나잇 다크</option>
              <option value="nordic-light" style={{ background: '#f0f7ff', color: '#0f172a' }}>노르딕 라이트</option>
              <option value="neon-cyber" style={{ background: '#050b18', color: '#00f0ff' }}>네온 사이버</option>
            </select>
          </div>

          {/* Daily History / Calendar Button */}
          <button
            type="button"
            onClick={onOpenDailyHistory}
            className="glass-btn"
            style={{ padding: '6px 10px', fontSize: '0.78rem', borderColor: 'rgba(56, 189, 248, 0.3)', color: 'var(--accent-blue)', cursor: 'pointer' }}
            title="일별 소비 캘린더 및 14일 통계 차트 열기"
          >
            <Calendar size={14} />
            <span>캘린더</span>
          </button>

          {/* Open Router Admin Page Button */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={handleOpenRouter}
              className="glass-btn"
              style={{ padding: '6px 10px', fontSize: '0.78rem', borderColor: 'rgba(56, 189, 248, 0.4)', color: 'var(--accent-blue)', cursor: 'pointer' }}
              title={networkBinding?.gatewayIp
                ? `${networkBinding.gatewayIp} 라우터 관리자 페이지 열기`
                : '현재 네트워크의 기본 게이트웨이 확인 후 열기'}
            >
              <Globe size={14} />
              <span>라우터</span>
              <ExternalLink size={11} />
            </button>
            {routerOpenError && (
              <div
                role="alert"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  right: 0,
                  width: '260px',
                  padding: '9px 11px',
                  borderRadius: '9px',
                  border: '1px solid rgba(244, 63, 94, 0.45)',
                  background: 'rgba(31, 13, 28, 0.96)',
                  color: '#fda4af',
                  fontSize: '0.7rem',
                  lineHeight: 1.45,
                  boxShadow: '0 10px 28px rgba(0, 0, 0, 0.35)',
                  zIndex: 1000
                }}
              >
                {routerOpenError}
              </div>
            )}
          </div>

          {/* Mini Floating Widget Toggle */}
          <button
            type="button"
            onClick={onToggleMiniGadget}
            className="glass-btn"
            style={{ padding: '6px 10px', fontSize: '0.78rem', cursor: 'pointer' }}
            title="화면 구석 상시 고정 미니 가젯으로 전환"
          >
            <Monitor size={14} />
            <span>미니</span>
          </button>

          {/* Problem report; shows a live badge while a diagnostic recording runs in the background */}
          <button
            type="button"
            onClick={onOpenReport}
            className="glass-btn"
            style={{
              padding: '6px 9px',
              cursor: 'pointer',
              ...(diagnosticRecording ? { color: 'var(--accent-rose)', borderColor: 'var(--accent-rose)' } : {})
            }}
            title={diagnosticRecording ? '진단 기록 중 · 문제 신고 창 열기' : '문제 신고'}
            aria-label={diagnosticRecording ? '진단 기록 중, 문제 신고 창 열기' : '문제 신고'}
          >
            <LifeBuoy size={14} />
            {diagnosticRecording && (
              <>
                <span className="pulse-dot" style={{ width: 7, height: 7, background: 'var(--accent-rose)', boxShadow: 'none' }} aria-hidden="true" />
                <span style={{ fontSize: '0.74rem', fontWeight: 700 }}>기록 중</span>
              </>
            )}
          </button>

          {/* Settings Button */}
          <button
            type="button"
            onClick={onOpenSettings}
            className="glass-btn"
            style={{ padding: '6px 9px', cursor: 'pointer' }}
            title="환경 설정"
            aria-label="환경 설정"
          >
            <Settings size={14} />
          </button>

        </div>

      </div>
    </header>
  );
}
