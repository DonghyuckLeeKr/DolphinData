import React from 'react';
import { ShieldCheck, AlertTriangle, AlertOctagon, Edit3, ExternalLink, Wifi, Infinity as InfinityIcon, EyeOff, Settings } from 'lucide-react';
import { calculateTotalUsedGB } from '../services/storageService';
import { getDaysRemainingInMonth, calculateDailyBudget } from '../utils/formatters';

export default function QuotaRingCard({ profile, config, networkBinding, onOpenNetworkSettings, onOpenCalibration }) {
  const target = profile || config || {};
  const meteringMode = networkBinding?.meteringMode || 'unclassified';

  if (meteringMode !== 'metered') {
    const state = !networkBinding
      ? {
          Icon: Wifi,
          title: '네트워크 연결 대기',
          badge: '사용량 누적 중지',
          description: '연결된 네트워크가 없습니다. 라우터를 연결하면 자동으로 다시 확인합니다.',
          color: 'var(--text-muted)'
        }
      : meteringMode === 'unmetered'
      ? {
          Icon: InfinityIcon,
          title: '무제한 네트워크',
          badge: '한도 차감 없음',
          description: '실시간 속도는 표시하지만 요금제 사용량에는 누적하지 않습니다.',
          color: 'var(--accent-emerald)'
        }
      : meteringMode === 'ignored'
        ? {
            Icon: EyeOff,
            title: '측정 제외 네트워크',
            badge: '사용량 저장 안 함',
            description: '이 네트워크의 송수신량은 요금제 사용량에 반영하지 않습니다.',
            color: 'var(--text-muted)'
          }
        : {
            Icon: Settings,
            title: '네트워크 정보 등록 필요',
            badge: '누적 보류',
            description: '현재 네트워크를 데이터 요금제, 무제한 네트워크 또는 측정 제외로 분류해 주세요.',
            color: 'var(--accent-amber)'
          };
    const StateIcon = state.Icon;

    return (
      <div className="glass-card" style={{ padding: '22px', minHeight: '250px', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ width: '52px', height: '52px', borderRadius: '16px', background: 'var(--glass-card)', border: `1px solid ${state.color}`, color: state.color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <StateIcon size={26} />
          </div>
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: 'var(--text-main)', margin: 0 }}>{state.title}</h3>
            <span style={{ fontSize: '0.73rem', color: state.color, fontWeight: 700 }}>{state.badge}</span>
          </div>
        </div>
        <div style={{ padding: '14px', borderRadius: '12px', background: 'rgba(255, 255, 255, 0.04)', border: '1px solid var(--glass-border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)', marginBottom: '6px' }}>
            <Wifi size={16} color="var(--brand-color)" />
            <b>{networkBinding?.networkName || '연결된 네트워크 없음'}</b>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.55, margin: 0 }}>{state.description}</p>
        </div>
        {networkBinding && (
          <button type="button" onClick={onOpenNetworkSettings} className="glass-btn" style={{ alignSelf: 'flex-start', cursor: 'pointer', color: 'var(--brand-color)', borderColor: 'var(--brand-color)' }}>
            <Settings size={15} />
            <span>네트워크 분류 설정</span>
          </button>
        )}
      </div>
    );
  }

  const totalUsedGB = calculateTotalUsedGB(target);
  const limitGB = target.monthlyLimitGB || 100;
  const remainingGB = Math.max(0, limitGB - totalUsedGB);
  const percentage = Math.min(100, Math.max(0, (totalUsedGB / limitGB) * 100));

  const daysLeft = getDaysRemainingInMonth(target.resetDay || 1);
  const dailyBudgetGB = calculateDailyBudget(remainingGB, target.resetDay || 1);

  // Status color & Level indicator calculation
  let statusColor = 'var(--accent-emerald)';
  let statusText = '안전 (Safe)';
  let StatusIcon = ShieldCheck;
  let levelText = '사용량 여유';

  if (percentage >= 95) {
    statusColor = 'var(--accent-rose)';
    statusText = '95%+ 긴급 위협';
    StatusIcon = AlertOctagon;
    levelText = '비상 절약';
  } else if (percentage >= 85) {
    statusColor = 'var(--accent-rose)';
    statusText = '85%+ 위험 경고';
    StatusIcon = AlertTriangle;
    levelText = '소진 주의보';
  } else if (percentage >= 60) {
    statusColor = 'var(--accent-amber)';
    statusText = '60%+ 주의 구간';
    StatusIcon = AlertTriangle;
    levelText = '적정 소비';
  } else if (percentage >= 30) {
    statusColor = 'var(--accent-blue)';
    statusText = '안전 구간';
    levelText = '순항 중';
  }

  // Real Moyo Plan Search URLs with configurable affiliate links
  const baseAffiliateUrl = target.affiliateUrl || 'https://www.moyoplan.com/plans';

  let shortMatch = {
    badge: '연 36만 원 절감',
    text: '데이터가 많이 남네요! 월 12,900원 알뜰폰 요금제 비교',
    url: `${baseAffiliateUrl}?sort=price_asc`,
    color: 'var(--accent-emerald)',
    bgColor: 'rgba(52, 211, 153, 0.12)',
    borderColor: 'rgba(52, 211, 153, 0.3)'
  };

  if (percentage >= 85) {
    shortMatch = {
      badge: '초과 요금 방지',
      text: '소진 위험! 월 19,800원 무제한 요금제 특가',
      url: `${baseAffiliateUrl}?data=unlimited`,
      color: 'var(--accent-rose)',
      bgColor: 'rgba(244, 63, 94, 0.12)',
      borderColor: 'rgba(244, 63, 94, 0.3)'
    };
  } else if (percentage >= 40 && percentage < 85) {
    shortMatch = {
      badge: '맞춤 요금제',
      text: '현재 소비량에 딱 맞는 가성비 알뜰폰 비교',
      url: baseAffiliateUrl,
      color: 'var(--brand-color)',
      bgColor: 'rgba(14, 165, 233, 0.12)',
      borderColor: 'rgba(14, 165, 233, 0.3)'
    };
  }

  const handleOpenLink = async (url) => {
    if (typeof window !== 'undefined' && window.__TAURI__?.shell?.open) {
      try {
        await window.__TAURI__.shell.open(url);
        return;
      } catch (e) {
        console.warn(e);
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // SVG Ring stroke calculation
  const radius = 64;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percentage / 100) * circumference;

  return (
    <div className="glass-card" style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
      
      {/* Card Title Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h3 style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--text-main)' }}>
              월간 데이터 한도 & 일일 가이드
            </h3>
            <span style={{
              fontSize: '0.7rem',
              fontWeight: '700',
              padding: '2px 8px',
              borderRadius: '12px',
              background: 'rgba(14, 165, 233, 0.15)',
              color: 'var(--accent-blue)',
              border: '1px solid rgba(14, 165, 233, 0.3)'
            }}>
              {levelText}
            </span>
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {target.name || target.carrierName || '모바일 데이터 요금제'} (월 {limitGB}GB)
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            padding: '4px 10px',
            borderRadius: '12px',
            background: 'var(--glass-card)',
            border: `1px solid ${statusColor}`,
            color: statusColor,
            fontSize: '0.75rem',
            fontWeight: '700'
          }}>
            <StatusIcon size={14} />
            <span>{statusText}</span>
          </div>

          <button
            onClick={onOpenCalibration}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--brand-color)',
              cursor: 'pointer',
              padding: '4px'
            }}
            title="이 요금제 정보 및 사용량 보정"
          >
            <Edit3 size={16} />
          </button>
        </div>
      </div>

      {/* Main Content Grid: Left Ring, Right Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '135px 1fr', gap: '18px', alignItems: 'center' }}>
        
        {/* SVG Ring Gauge */}
        <div style={{ position: 'relative', width: '135px', height: '135px', margin: '0 auto' }}>
          <svg width="135" height="135" viewBox="0 0 140 140">
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke="rgba(255, 255, 255, 0.08)"
              strokeWidth="11"
            />
            <circle
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              stroke={statusColor}
              strokeWidth="11"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              transform="rotate(-90 70 70)"
              style={{ transition: 'stroke-dashoffset 0.8s ease, stroke 0.4s' }}
            />
          </svg>
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center'
          }}>
            <span style={{ fontSize: '1.55rem', fontWeight: '800', lineHeight: 1, color: 'var(--text-main)' }}>
              {percentage.toFixed(1)}%
            </span>
            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>
              소진됨
            </span>
          </div>
        </div>

        {/* Right Numbers & Daily Pacing Guide */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          
          {/* GB Numbers */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            <div>
              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block' }}>사용한 용량</span>
              <span style={{ fontSize: '1.2rem', fontWeight: '700', color: 'var(--text-main)' }}>
                {totalUsedGB.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB</span>
              </span>
            </div>

            <div>
              <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block' }}>남은 용량</span>
              <span style={{ fontSize: '1.2rem', fontWeight: '700', color: statusColor }}>
                {remainingGB.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB</span>
              </span>
            </div>
          </div>

          {/* Daily Pacing Box */}
          <div style={{
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid var(--glass-border-light)',
            borderRadius: '10px',
            padding: '8px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                오늘의 안전 권장 사용량
              </span>
              <div style={{ fontSize: '1.08rem', fontWeight: '800', color: 'var(--accent-blue)', marginTop: '1px' }}>
                {dailyBudgetGB.toFixed(2)} GB <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 500 }}>/ 일</span>
              </div>
            </div>

            <div style={{ textAlign: 'right', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
              <div>이번 달 <b>{daysLeft}일</b> 남음</div>
              <div>매월 <b>{target.resetDay || 1}일</b> 리셋</div>
            </div>
          </div>

        </div>

      </div>

      {/* Integrated Short Smart Recommendation Bar linking to real Moyo Plan pages */}
      <div
        onClick={() => handleOpenLink(shortMatch.url)}
        style={{
          background: shortMatch.bgColor,
          border: `1px solid ${shortMatch.borderColor}`,
          borderRadius: '10px',
          padding: '8px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          transition: 'transform 0.15s ease',
          userSelect: 'none'
        }}
        title="클릭 시 실제 모요(Moyo) 맞춤 요금제 비교 사이트로 이동"
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', overflow: 'hidden' }}>
          <span style={{
            fontSize: '0.7rem',
            fontWeight: '800',
            color: shortMatch.color,
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}>
            {shortMatch.badge}
          </span>
          <span style={{
            fontSize: '0.78rem',
            color: 'var(--text-main)',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            overflow: 'hidden'
          }}>
            {shortMatch.text}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '3px', color: shortMatch.color, fontSize: '0.75rem', fontWeight: '700', flexShrink: 0 }}>
          <span>보기</span>
          <ExternalLink size={12} />
        </div>
      </div>

    </div>
  );
}
