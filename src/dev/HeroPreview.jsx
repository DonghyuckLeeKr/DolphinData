// Dev-only playground for WaterLevelHero with synthetic plans; not part of the app bundle.
import { useMemo, useState } from 'react';
import WaterLevelHero from '../components/WaterLevelHero';
import { getBillingWindow } from '../services/usageForecast';
import { getTodayKey } from '../services/storageService';

const PRESETS = {
  safe: { label: '여유', usedPercent: 22, speed: 0.05 },
  tight: { label: '아슬아슬', usedPercent: 74, speed: 1.2 },
  over: { label: '소진 예상', usedPercent: 88, speed: 6 },
  exhausted: { label: '소진', usedPercent: 100, speed: 0 }
};

const LIMIT_GB = 100;
const RESET_DAY = 1;

// Spread the used amount across elapsed days with some weekday noise so the burn-down looks real.
const buildHistory = (usedGB, now) => {
  const { start } = getBillingWindow(RESET_DAY, now);
  const days = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - start) / 86400000) + 1;
  const weights = Array.from({ length: days }, (_, index) => 0.6 + ((index * 37) % 11) / 10);
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return Object.fromEntries(weights.map((weight, index) => {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return [getTodayKey(day), (usedGB * weight) / total];
  }));
};

export default function HeroPreview() {
  const [usedPercent, setUsedPercent] = useState(PRESETS.over.usedPercent);
  const [speedMB, setSpeedMB] = useState(PRESETS.over.speed);
  const [theme, setTheme] = useState('soft-dark');
  const now = useMemo(() => new Date(), []);
  const usedGB = (LIMIT_GB * usedPercent) / 100;
  const dailyGB = useMemo(() => buildHistory(usedGB, now), [usedGB, now]);

  const applyTheme = value => { setTheme(value); document.documentElement.setAttribute('data-theme', value); };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-gradient)', color: 'var(--text-main)', fontFamily: 'var(--font-family)', padding: '24px 20px' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto' }}>
        <div className="glass-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', padding: '12px 16px', marginBottom: 18, fontSize: '0.82rem' }}>
          <b>미리보기 상태</b>
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button key={key} type="button" className="glass-btn" onClick={() => { setUsedPercent(preset.usedPercent); setSpeedMB(preset.speed); }}>
              {preset.label}
            </button>
          ))}
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            사용률 {usedPercent}%
            <input type="range" min="0" max="100" value={usedPercent} onChange={event => setUsedPercent(Number(event.target.value))} />
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            속도 {speedMB} MB/s
            <input type="range" min="0" max="20" step="0.05" value={speedMB} onChange={event => setSpeedMB(Number(event.target.value))} />
          </label>
          <select value={theme} onChange={event => applyTheme(event.target.value)} className="glass-btn">
            <option value="soft-dark">소프트 다크</option>
            <option value="midnight-black">미드나잇</option>
            <option value="nordic-light">노르딕 라이트</option>
          </select>
        </div>
        <WaterLevelHero
          profile={{ name: '에그 요금제', monthlyLimitGB: LIMIT_GB, resetDay: RESET_DAY }}
          usedGB={usedGB}
          dailyGB={dailyGB}
          downloadSpeed={speedMB * 1024 * 1024}
          onOpenCalibration={() => {}}
          now={now}
        />
      </div>
    </div>
  );
}
