import React from 'react';
import { Wifi, Infinity as InfinityIcon, EyeOff, Settings } from 'lucide-react';

export default function QuotaRingCard({ networkBinding, onOpenNetworkSettings }) {
  const meteringMode = networkBinding?.meteringMode || 'unclassified';

  if (meteringMode !== 'metered') {
    const state = !networkBinding
      ? {
          Icon: Wifi,
          title: '네트워크 연결 대기',
          badge: '사용량 세지 않음',
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
            title: '이 네트워크를 알려 주세요',
            badge: '요금제 연결 전',
            description: '데이터 요금제인지, 무제한 Wi-Fi인지, 측정에서 뺄지 정해 주세요. 정하기 전에는 사용량을 세지 않습니다.',
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

  // On a metered network the water-level hero shows the plan, so this card stays empty.
  return null;
}
