import React, { useState, useMemo, memo } from 'react';
import { X, Calendar, BarChart3 } from 'lucide-react';
import { getDailyHistoryGB, getTodayKey } from '../services/storageService';

function DailyHistoryModal({ config, activeProfile, onClose }) {
  const [viewMode, setViewMode] = useState('chart'); // 'chart' or 'list'
  const history = useMemo(
    () => getDailyHistoryGB(config, activeProfile?.id),
    [config, activeProfile?.id]
  );
  const todayKey = getTodayKey();

  // Generate last 14 days dates array
  const last14Days = useMemo(() => {
    const list = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const dayLabel = `${d.getMonth() + 1}/${d.getDate()}`;
      const gb = parseFloat(history[key]) || 0;
      list.push({ key, label: dayLabel, gb, isToday: key === todayKey });
    }
    return list;
  }, [history, todayKey]);

  // Calculate statistics
  const total14DaysGB = useMemo(() => last14Days.reduce((acc, curr) => acc + curr.gb, 0), [last14Days]);
  const avgDailyGB = total14DaysGB / 14;
  const maxDay = useMemo(() => [...last14Days].sort((a, b) => b.gb - a.gb)[0] || { label: '-', gb: 0 }, [last14Days]);
  const maxChartGB = useMemo(() => Math.max(1, ...last14Days.map(d => d.gb)), [last14Days]);

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
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: '600px',
          padding: '24px',
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
          onClick={onClose}
          type="button"
          aria-label="일별 데이터 소비 캘린더 및 통계 창 닫기"
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
            <Calendar size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)' }}>
              일별 데이터 소비 캘린더 & 통계
            </h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              최근 14일간의 일별 데이터 사용량 추이를 확인합니다.
            </p>
          </div>
        </div>

        {/* 3 Quick Summary Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginBottom: '18px' }}>
          <div className="glass-card" style={{ padding: '10px 14px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>최근 14일 합계</span>
            <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text-main)' }}>
              {total14DaysGB.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB</span>
            </span>
          </div>

          <div className="glass-card" style={{ padding: '10px 14px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>일평균 사용량</span>
            <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--accent-blue)' }}>
              {avgDailyGB.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB/일</span>
            </span>
          </div>

          <div className="glass-card" style={{ padding: '10px 14px' }}>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'block' }}>최대 소비일 ({maxDay.label})</span>
            <span style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--accent-rose)' }}>
              {maxDay.gb.toFixed(2)} <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>GB</span>
            </span>
          </div>
        </div>

        {/* View Mode Toggle */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <span style={{ fontSize: '0.82rem', fontWeight: '700', color: 'var(--text-main)' }}>
            최근 14일 소비 추이
          </span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setViewMode('chart')}
              className="glass-btn"
              style={{
                padding: '4px 10px',
                fontSize: '0.72rem',
                background: viewMode === 'chart' ? 'var(--brand-badge-bg)' : undefined,
                color: viewMode === 'chart' ? 'var(--brand-color)' : undefined,
                cursor: 'pointer'
              }}
            >
              <BarChart3 size={13} />
              <span>막대 차트</span>
            </button>
            <button
              onClick={() => setViewMode('list')}
              className="glass-btn"
              style={{
                padding: '4px 10px',
                fontSize: '0.72rem',
                background: viewMode === 'list' ? 'var(--brand-badge-bg)' : undefined,
                color: viewMode === 'list' ? 'var(--brand-color)' : undefined,
                cursor: 'pointer'
              }}
            >
              <Calendar size={13} />
              <span>상세 목록</span>
            </button>
          </div>
        </div>

        {/* Chart View */}
        {viewMode === 'chart' ? (
          <div className="glass-card" style={{ padding: '16px 14px', height: '180px', display: 'flex', alignItems: 'flex-end', gap: '6px' }}>
            {last14Days.map((day, idx) => {
              const heightPct = Math.max(6, (day.gb / maxChartGB) * 100);
              const isHigh = day.gb >= (config?.dailySurgeLimitGB || 5);

              return (
                <div
                  key={idx}
                  style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '6px',
                    height: '100%',
                    justifyContent: 'flex-end'
                  }}
                  title={`${day.key}: ${day.gb.toFixed(2)} GB`}
                >
                  <span style={{ fontSize: '0.62rem', color: day.isToday ? 'var(--accent-blue)' : 'var(--text-dim)', fontWeight: '600' }}>
                    {day.gb > 0 ? day.gb.toFixed(1) : ''}
                  </span>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: '22px',
                      height: `${heightPct}%`,
                      background: day.isToday
                        ? 'var(--brand-gradient)'
                        : isHigh
                          ? 'var(--accent-rose)'
                          : 'rgba(56, 189, 248, 0.35)',
                      borderRadius: '6px 6px 2px 2px',
                      transition: 'height 0.4s ease'
                    }}
                  />
                  <span style={{ fontSize: '0.65rem', color: day.isToday ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: day.isToday ? '700' : '400' }}>
                    {day.label}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div style={{ maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
            {last14Days.slice().reverse().map((day, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 12px',
                  background: day.isToday ? 'var(--brand-badge-bg)' : 'var(--glass-card)',
                  borderRadius: '8px',
                  border: `1px solid ${day.isToday ? 'var(--brand-color)' : 'var(--glass-border-light)'}`,
                  fontSize: '0.78rem'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: day.isToday ? 'var(--brand-color)' : 'var(--text-main)', fontWeight: day.isToday ? '700' : '500' }}>
                    {day.key} {day.isToday ? '(오늘)' : ''}
                  </span>
                </div>
                <span style={{ fontWeight: '700', color: day.gb >= (config?.dailySurgeLimitGB || 5) ? 'var(--accent-rose)' : 'var(--text-main)' }}>
                  {day.gb.toFixed(2)} GB
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--glass-border)' }}>
          <button onClick={onClose} className="glass-btn glass-btn-primary" style={{ cursor: 'pointer' }}>
            닫기
          </button>
        </div>

      </div>
    </div>
  );
}

export default memo(DailyHistoryModal);
