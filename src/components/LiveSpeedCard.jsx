import React, { useState, useEffect } from 'react';
import { ArrowDown, ArrowUp, Activity } from 'lucide-react';
import { formatSpeed } from '../utils/formatters';

export default function LiveSpeedCard({ telemetry, unitMode }) {
  const [peakDown, setPeakDown] = useState(0);
  const [peakUp, setPeakUp] = useState(0);

  useEffect(() => {
    setPeakDown(previous => Math.max(previous, telemetry.downloadSpeed || 0));
    setPeakUp(previous => Math.max(previous, telemetry.uploadSpeed || 0));
  }, [telemetry.downloadSpeed, telemetry.uploadSpeed]);

  return (
    <div className="glass-card" style={{ padding: '24px', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Activity size={18} color="var(--accent-blue)" />
          지금 속도
        </h3>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          단위: {unitMode === 'Mbps' ? 'Mbps' : 'MB/s'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', margin: 'auto 0' }}>
        
        {/* Download Speed Meter */}
        <div style={{
          background: 'rgba(56, 189, 248, 0.08)',
          border: '1px solid rgba(56, 189, 248, 0.25)',
          borderRadius: '16px',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-blue)', marginBottom: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'rgba(56, 189, 248, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ArrowDown size={18} />
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>다운로드</span>
          </div>

          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--text-main)', lineHeight: 1.1 }}>
            {formatSpeed(telemetry.downloadSpeed, unitMode)}
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            최고: {formatSpeed(peakDown, unitMode)}
          </div>
        </div>

        {/* Upload Speed Meter */}
        <div style={{
          background: 'rgba(192, 132, 252, 0.08)',
          border: '1px solid rgba(192, 132, 252, 0.25)',
          borderRadius: '16px',
          padding: '18px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-purple)', marginBottom: '8px' }}>
            <div style={{
              width: '28px',
              height: '28px',
              borderRadius: '8px',
              background: 'rgba(192, 132, 252, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <ArrowUp size={18} />
            </div>
            <span style={{ fontSize: '0.85rem', fontWeight: '700' }}>업로드</span>
          </div>

          <div style={{ fontSize: '1.8rem', fontWeight: '800', color: 'var(--text-main)', lineHeight: 1.1 }}>
            {formatSpeed(telemetry.uploadSpeed, unitMode)}
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '8px' }}>
            최고: {formatSpeed(peakUp, unitMode)}
          </div>
        </div>

      </div>
    </div>
  );
}
