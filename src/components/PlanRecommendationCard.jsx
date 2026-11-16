import React from 'react';
import { Sparkles, ExternalLink, ShieldAlert, Award, PiggyBank } from 'lucide-react';
import { calculateTotalUsedGB } from '../services/storageService';

export default function PlanRecommendationCard({ config }) {
  const totalUsedGB = calculateTotalUsedGB(config);
  const limitGB = config.monthlyLimitGB || 100;
  const usagePercentage = (totalUsedGB / limitGB) * 100;

  // Recommendation Logic based on actual data usage
  let recommendation = {
    type: 'SAVINGS', // 'SAVINGS' | 'UPGRADE' | 'OPTIMAL'
    badge: '💡 요금 절감 진단',
    title: '데이터가 과도하게 남습니다! 연 36만 원 절약 가능',
    subtitle: `이번 달 사용량은 ${totalUsedGB.toFixed(1)}GB로 전체 한도(${limitGB}GB)의 ${usagePercentage.toFixed(0)}%만 소비하셨습니다.`,
    recommendedPlanName: '알뜰폰 30GB 무제한 (월 12,900원)',
    estimatedSavings: '월 약 30,000원 절감',
    linkUrl: 'https://www.moyoplan.com/', // Moyo or MVNO affiliate link
    ctaText: '절감 가능한 요금제 비교하기',
    cardBorder: 'rgba(52, 211, 153, 0.4)',
    accentColor: 'var(--accent-emerald)'
  };

  if (usagePercentage >= 85) {
    recommendation = {
      type: 'UPGRADE',
      badge: '🚨 초과 요금 방지 특가',
      title: '데이터 소진 위험! 무제한 요금제로 변경 추천',
      subtitle: `현재 사용량이 ${usagePercentage.toFixed(0)}%에 달했습니다. 초과 데이터 요금 부과 전 무제한 요금제를 확인하세요.`,
      recommendedPlanName: '100GB + 5Mbps 무제한 (월 19,800원)',
      estimatedSavings: '데이터 차단 걱정 0%',
      linkUrl: 'https://www.moyoplan.com/',
      ctaText: '무제한 요금제 특가 보기',
      cardBorder: 'rgba(244, 63, 94, 0.4)',
      accentColor: 'var(--accent-rose)'
    };
  } else if (usagePercentage >= 40 && usagePercentage < 85) {
    recommendation = {
      type: 'OPTIMAL',
      badge: '✨ 황금 밸런스 추천',
      title: '현재 사용 패턴에 딱 맞는 맞춤형 데이터 요금제',
      subtitle: `월 평균 ${totalUsedGB.toFixed(1)}GB를 알차게 소비 중이시네요! 동일 데이터 조건의 더 저렴한 통신사를 비교해 보세요.`,
      recommendedPlanName: `${limitGB}GB 전용 알뜰 요금제 (월 15,900원)`,
      estimatedSavings: '월 약 22,000원 절감',
      linkUrl: 'https://www.moyoplan.com/',
      ctaText: '맞춤 요금제 비교하기',
      cardBorder: 'rgba(99, 102, 241, 0.4)',
      accentColor: 'var(--brand-color)'
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

  return (
    <div
      className="glass-card"
      style={{
        padding: '18px 22px',
        marginTop: '18px',
        border: `1px solid ${recommendation.cardBorder}`,
        background: 'rgba(15, 23, 42, 0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
        gap: '16px'
      }}
    >
      {/* Left Text Block */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '14px', flex: 1, minWidth: '300px' }}>
        
        <div style={{
          width: '42px',
          height: '42px',
          borderRadius: '12px',
          background: 'rgba(255, 255, 255, 0.05)',
          border: `1px solid ${recommendation.cardBorder}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: recommendation.accentColor,
          flexShrink: 0
        }}>
          {recommendation.type === 'SAVINGS' && <PiggyBank size={22} />}
          {recommendation.type === 'UPGRADE' && <ShieldAlert size={22} />}
          {recommendation.type === 'OPTIMAL' && <Award size={22} />}
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <span style={{
              fontSize: '0.72rem',
              fontWeight: '700',
              padding: '2px 8px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.08)',
              color: recommendation.accentColor
            }}>
              {recommendation.badge}
            </span>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              실시간 데이터 소비 진단 결과
            </span>
          </div>

          <h4 style={{ fontSize: '0.98rem', fontWeight: '700', color: 'var(--text-main)', margin: '0 0 2px 0' }}>
            {recommendation.title}
          </h4>

          <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: 0 }}>
            {recommendation.subtitle}, <b>추천: {recommendation.recommendedPlanName} ({recommendation.estimatedSavings})</b>
          </p>
        </div>

      </div>

      {/* Right CTA Button */}
      <button
        onClick={() => handleOpenLink(recommendation.linkUrl)}
        className="glass-btn glass-btn-primary"
        style={{
          padding: '10px 18px',
          fontSize: '0.82rem',
          fontWeight: '700',
          background: recommendation.accentColor,
          borderColor: recommendation.accentColor,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          borderRadius: '10px',
          whiteSpace: 'nowrap'
        }}
      >
        <Sparkles size={15} />
        <span>{recommendation.ctaText}</span>
        <ExternalLink size={14} />
      </button>

    </div>
  );
}
