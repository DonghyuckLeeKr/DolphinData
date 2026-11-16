import React, { useRef, useEffect } from 'react';
import { formatSpeed } from '../utils/formatters';
import { getNetworkDisplayInfo } from '../utils/networkDisplay';

export default function TrafficTimeSeriesChart({ historyData, unitMode, profile }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);

    if (!historyData || historyData.length < 2) return;

    // Find max value
    const maxVal = Math.max(
      100000, // min scale 100 KB/s
      ...historyData.map(d => Math.max(d.downloadSpeed || 0, d.uploadSpeed || 0))
    );

    // Padding
    const pTop = 20;
    const pBottom = 30;
    const pLeft = 10;
    const pRight = 10;
    const graphW = width - pLeft - pRight;
    const graphH = height - pTop - pBottom;

    // Draw Grid
    ctx.strokeStyle = 'rgba(148, 163, 184, 0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pTop + (graphH / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pLeft, y);
      ctx.lineTo(width - pRight, y);
      ctx.stroke();
    }

    // Helper to map x, y
    const getX = (index) => pLeft + (index / (historyData.length - 1)) * graphW;
    const getY = (val) => pTop + graphH - (val / maxVal) * graphH;

    // Draw Download Area & Path
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(historyData[0].downloadSpeed));
    for (let i = 1; i < historyData.length; i++) {
      ctx.lineTo(getX(i), getY(historyData[i].downloadSpeed));
    }
    
    // Download stroke
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Fill download gradient
    ctx.lineTo(getX(historyData.length - 1), pTop + graphH);
    ctx.lineTo(getX(0), pTop + graphH);
    ctx.closePath();
    const gradDown = ctx.createLinearGradient(0, pTop, 0, pTop + graphH);
    gradDown.addColorStop(0, 'rgba(56, 189, 248, 0.25)');
    gradDown.addColorStop(1, 'rgba(56, 189, 248, 0.0)');
    ctx.fillStyle = gradDown;
    ctx.fill();

    // Draw Upload Path
    ctx.beginPath();
    ctx.moveTo(getX(0), getY(historyData[0].uploadSpeed));
    for (let i = 1; i < historyData.length; i++) {
      ctx.lineTo(getX(i), getY(historyData[i].uploadSpeed));
    }
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    ctx.stroke();

  }, [historyData]);

  const currentDown = historyData.length > 0 ? historyData[historyData.length - 1].downloadSpeed : 0;
  const currentUp = historyData.length > 0 ? historyData[historyData.length - 1].uploadSpeed : 0;
  const networkDisplay = getNetworkDisplayInfo(profile);

  return (
    <div className="glass-card" style={{ padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div>
          <h3 style={{ fontSize: '1rem', fontWeight: '600', color: 'var(--text-main)' }}>
            최근 1분 속도
          </h3>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            {networkDisplay.trafficDescription}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', fontSize: '0.8rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#38bdf8' }}></span>
            <span style={{ color: 'var(--text-main)' }}>다운로드 ({formatSpeed(currentDown, unitMode)})</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#a78bfa' }}></span>
            <span style={{ color: 'var(--text-main)' }}>업로드 ({formatSpeed(currentUp, unitMode)})</span>
          </div>
        </div>
      </div>

      <div style={{ width: '100%', height: '180px', position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={180}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </div>
    </div>
  );
}
