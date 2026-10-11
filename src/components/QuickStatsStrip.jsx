import React from 'react';
import { ArrowDown, ArrowUp, Clock, Wifi } from 'lucide-react';
import { formatBytes, getDaysRemainingInMonth } from '../utils/formatters';
import { getNetworkDisplayInfo } from '../utils/networkDisplay';

export default function QuickStatsStrip({ telemetry, config, activeProfile, networkBinding }) {
  const profile = activeProfile || config || {};
  const networkDisplay = getNetworkDisplayInfo(networkBinding || {});
  const daysLeft = getDaysRemainingInMonth(profile.resetDay || 1);
  const totalDownBytes = telemetry.totalRx || 0;
  const totalUpBytes = telemetry.totalTx || 0;

  return (
    <div className="quick-stats-strip">
      {/* Stat 1: Today Downloaded */}
      <div className="glass-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'rgba(56, 189, 248, 0.12)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-blue)',
          flexShrink: 0
        }}>
          <ArrowDown size={18} />
        </div>
        <div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>세션 다운로드</span>
          <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)' }}>
            {formatBytes(totalDownBytes)}
          </span>
        </div>
      </div>

      {/* Stat 2: Today Uploaded */}
      <div className="glass-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'rgba(167, 139, 250, 0.12)',
          border: '1px solid rgba(167, 139, 250, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-purple)',
          flexShrink: 0
        }}>
          <ArrowUp size={18} />
        </div>
        <div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>세션 업로드</span>
          <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)' }}>
            {formatBytes(totalUpBytes)}
          </span>
        </div>
      </div>

      {/* Stat 3: Reset Days Left */}
      <div className="glass-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'rgba(52, 211, 153, 0.12)',
          border: '1px solid rgba(52, 211, 153, 0.25)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--accent-emerald)',
          flexShrink: 0
        }}>
          <Clock size={18} />
        </div>
        <div>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>다음 리셋까지</span>
          <span style={{ fontSize: '1.1rem', fontWeight: '700', color: 'var(--text-main)' }}>
            {daysLeft}일 남음
          </span>
        </div>
      </div>

      {/* Stat 4: Network Interface Status */}
      <div className="glass-card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          background: 'var(--brand-badge-bg)',
          border: '1px solid var(--brand-badge-border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--brand-color)',
          flexShrink: 0
        }}>
          <Wifi size={18} />
        </div>
        <div style={{ overflow: 'hidden' }}>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'block' }}>{networkDisplay.label}</span>
          <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px', display: 'block' }}>
            {networkBinding?.networkName || networkBinding?.interfaceName || '연결 확인 중'}
          </span>
        </div>
      </div>

    </div>
  );
}
