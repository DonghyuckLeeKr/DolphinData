import React, { useId, useMemo } from 'react';
import { Edit3 } from 'lucide-react';
import { forecastUsage } from '../services/usageForecast';
import './WaterLevelHero.css';

// Water and accent colours per status live in WaterLevelHero.css so each theme can tune its contrast.

const TANK_SIZE = 200;
const WAVE_WIDTH = 400;
const WAVE_HALF_PERIOD = 50;

// A seamless sine strip twice the tank width; drifting it by half its width loops without a seam.
const wavePath = amplitude => {
  let d = `M0 0`;
  for (let x = 0, up = true; x < WAVE_WIDTH; x += WAVE_HALF_PERIOD, up = !up) {
    d += ` Q${x + WAVE_HALF_PERIOD / 2} ${up ? -amplitude * 2 : amplitude * 2} ${x + WAVE_HALF_PERIOD} 0`;
  }
  return `${d} L${WAVE_WIDTH} ${TANK_SIZE + 30} L0 ${TANK_SIZE + 30} Z`;
};

// 0 when idle, 1 at roughly 10 MB/s and above, on a log scale so light browsing still ripples.
const speedIntensity = bytesPerSecond => {
  const speed = Math.max(0, Number(bytesPerSecond) || 0);
  if (speed < 10 * 1024) return 0;
  return Math.min(1, Math.log10(speed / (10 * 1024)) / 3);
};

const formatGB = value => (value >= 100 ? value.toFixed(0) : value >= 10 ? value.toFixed(1) : value.toFixed(2));
const formatShortDate = date => `${date.getMonth() + 1}/${date.getDate()}`;
const formatLongDate = date => new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }).format(date);

const BUBBLES = [
  { x: 62, size: 2.6, delay: 0, duration: 4.2 },
  { x: 128, size: 1.8, delay: 1.1, duration: 3.6 },
  { x: 96, size: 3.2, delay: 2.3, duration: 5 },
  { x: 146, size: 2.2, delay: 0.6, duration: 4.6 },
  { x: 74, size: 1.6, delay: 3, duration: 3.4 },
  { x: 116, size: 2.4, delay: 1.8, duration: 4 }
];

// Side view facing right. What separates a dolphin from a fish: the round melon over a slim beak,
// the hooked dorsal fin, a pale belly, and a horizontal fluke instead of a vertical tail.
function Dolphin() {
  const shadeId = useId();
  return (
    <g className="water-hero__dolphin" strokeLinejoin="round">
      {/* Same light-to-deep blue as the app icon's dolphin */}
      <defs>
        <linearGradient id={shadeId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: 'var(--dolphin-top)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--dolphin-bottom)' }} />
        </linearGradient>
      </defs>
      <path
        className="water-hero__dolphin-body"
        fill={`url(#${shadeId})`}
        d="M48 6 C45 4 41 3 38 2 C37 -4 34 -8 28 -10 C20 -13 12 -14 6 -14 C2 -19 -2 -24 -6 -27 C-6 -22 -7 -16 -10 -12 C-20 -9 -30 -3 -37 4 C-41 0 -46 -3 -51 -3 C-48 1 -46 5 -45 8 C-48 11 -50 14 -51 17 C-46 15 -41 12 -37 10 C-28 11 -15 10 -2 10 C14 10 28 10 38 9 C42 8 46 8 48 6 Z"
      />
      <path className="water-hero__dolphin-belly" d="M44 7.5 C36 8.5 24 9.5 8 9.6 C-8 9.8 -22 10 -34 9.5 C-24 6 -8 4.5 8 4.5 C22 4.5 34 5 44 7.5 Z" />
      <path className="water-hero__dolphin-body" fill={`url(#${shadeId})`} d="M14 9 C12 15 8 19 3 21 C6 16 8 12 9 10 Z" />
      <path d="M47 6.4 C43 6.2 40 6.6 36.5 7.6" fill="none" stroke="rgba(8, 24, 48, 0.55)" strokeWidth="0.9" strokeLinecap="round" />
      <circle cx="31" cy="-1.5" r="1.7" fill="#0b1b33" />
      <circle cx="31.6" cy="-2.1" r="0.5" fill="#fff" />
    </g>
  );
}

function BurnChart({ forecast, accent }) {
  const width = 300;
  const height = 92;
  const { totalDays, limitGB, series, elapsedDays, projectedTotalGB, depletionDate, start } = forecast;
  const ceiling = Math.max(limitGB * 1.15, projectedTotalGB * 1.02, 1);
  const x = day => (Math.min(totalDays, Math.max(0, day)) / totalDays) * width;
  const y = gb => height - 4 - (Math.min(ceiling, Math.max(0, gb)) / ceiling) * (height - 12);

  const points = series.map((point, index) => [
    x(index === series.length - 1 ? elapsedDays : point.dayIndex + 1),
    y(point.cumulativeGB)
  ]);
  points.unshift([0, y(0)]);
  const line = points.map(([px, py], index) => `${index ? 'L' : 'M'}${px.toFixed(1)} ${py.toFixed(1)}`).join(' ');
  const [todayX, todayY] = points[points.length - 1];
  const area = `${line} L${todayX.toFixed(1)} ${height} L0 ${height} Z`;
  const depletionX = depletionDate ? x((depletionDate - start) / 86400000) : null;
  const gradientId = useId();

  return (
    <svg className="water-hero__chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" style={{ stopColor: accent }} stopOpacity="0.35" />
          <stop offset="100%" style={{ stopColor: accent }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={width} y1={y(limitGB)} y2={y(limitGB)} style={{ stroke: 'var(--hero-limit-line)' }} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
      <line x1="0" y1={y(0)} x2={width} y2={y(limitGB)} style={{ stroke: 'var(--hero-budget-line)' }} strokeDasharray="2 5" vectorEffect="non-scaling-stroke" />
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} fill="none" style={{ stroke: accent }} strokeWidth="2.2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <line x1={todayX} y1={todayY} x2={width} y2={y(projectedTotalGB)} style={{ stroke: accent }} strokeWidth="1.6" strokeDasharray="4 4" opacity="0.8" vectorEffect="non-scaling-stroke" />
      {depletionX !== null && (
        <line x1={depletionX} x2={depletionX} y1={y(limitGB) - 6} y2={height} style={{ stroke: 'var(--accent-rose)' }} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  );
}

export default function WaterLevelHero({ profile, dailyGB = {}, usedGB, downloadSpeed = 0, uploadSpeed = 0, onOpenCalibration, now }) {
  const limitGB = Number(profile?.monthlyLimitGB) || 100;
  const resetDay = profile?.resetDay || 1;
  const forecast = useMemo(
    () => forecastUsage({ usedGB, limitGB, resetDay, dailyGB, now: now || new Date() }),
    [usedGB, limitGB, resetDay, dailyGB, now]
  );
  const clipId = useId();
  const gradientId = useId();
  const glassId = useId();

  const remainingRatio = limitGB > 0 ? forecast.remainingGB / limitGB : 0;
  const intensity = speedIntensity((Number(downloadSpeed) || 0) + (Number(uploadSpeed) || 0));
  // Keep a visible sliver of water until the plan is truly empty.
  // A full plan still leaves headroom above the surface so the dolphin stays inside the porthole.
  const levelY = remainingRatio <= 0 ? TANK_SIZE + 4 : 30 + (1 - Math.max(0.03, remainingRatio)) * (TANK_SIZE - 36);
  const amplitude = 1.6 + intensity * 5.5;
  const bubbleCount = Math.round(intensity * BUBBLES.length);

  const remainingPercent = Math.max(0, 100 - forecast.percentUsed);
  const daysShort = forecast.depletionDate ? Math.max(0, Math.ceil((forecast.end - forecast.depletionDate) / 86400000)) : 0;

  let headline;
  let sub;
  if (forecast.status === 'exhausted') {
    headline = <>이번 달 데이터를 <em>모두 썼어요</em></>;
    sub = `${formatLongDate(forecast.end)} 리셋까지 ${Math.ceil(forecast.remainingDays)}일 남았어요.`;
  } else if (forecast.status === 'over') {
    headline = <>이 속도면 <em>{formatLongDate(forecast.depletionDate)}</em>에 바닥나요</>;
    sub = `리셋보다 ${daysShort}일 빨라요 · 하루 평균 ${formatGB(forecast.dailyPaceGB)} GB 사용 중`;
  } else if (forecast.status === 'tight') {
    headline = <>리셋일까지 <em>아슬아슬하게</em> 버틸 수 있어요</>;
    sub = `예상 사용량 ${formatGB(forecast.projectedTotalGB)} GB · 하루 평균 ${formatGB(forecast.dailyPaceGB)} GB`;
  } else if (forecast.usedGB === 0) {
    headline = <>이번 달 데이터가 <em>가득</em> 차 있어요</>;
    sub = `${formatLongDate(forecast.end)}에 리셋돼요. 사용하기 시작하면 소진 예상일을 알려 드려요.`;
  } else {
    headline = <>이 속도면 리셋일까지 <em>넉넉해요</em></>;
    sub = `예상 사용량 ${formatGB(forecast.projectedTotalGB)} GB · 하루 평균 ${formatGB(forecast.dailyPaceGB)} GB`;
  }

  const todayRatio = forecast.todayBudgetGB > 0 ? Math.min(1, forecast.todayUsedGB / forecast.todayBudgetGB) : 1;
  const todayMessage = forecast.todayLeftGB >= 0
    ? <>오늘 <b>{formatGB(forecast.todayLeftGB)} GB</b> 더 써도 괜찮아요</>
    : <>오늘 권장량보다 <b>{formatGB(-forecast.todayLeftGB)} GB</b> 더 썼어요</>;

  return (
    <section className="glass-card water-hero" data-status={forecast.status} style={{ '--wave-period': `${7 - intensity * 4}s` }}>
      <div
        className="water-hero__tank"
        role="img"
        aria-label={`남은 데이터 ${remainingPercent.toFixed(0)}퍼센트, ${formatGB(forecast.remainingGB)}기가바이트`}
      >
        <svg viewBox={`0 0 ${TANK_SIZE} ${TANK_SIZE}`}>
          <defs>
            <clipPath id={clipId}>
              <circle cx="100" cy="100" r="94" />
            </clipPath>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--water-top)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--water-bottom)' }} />
            </linearGradient>
            {/* Glass: a darkened edge for depth, a soft crescent along the upper-left rim, a small specular glint */}
            <radialGradient id={`${glassId}-depth`} cx="50%" cy="48%" r="52%">
              <stop offset="86%" stopColor="#000" stopOpacity="0" />
              <stop offset="100%" style={{ stopColor: 'var(--hero-glass-edge)' }} />
            </radialGradient>
            <linearGradient id={`${glassId}-sheen`} x1="0.15" y1="0.1" x2="0.6" y2="0.65">
              <stop offset="0%" style={{ stopColor: 'var(--hero-glass-sheen)' }} />
              <stop offset="100%" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <linearGradient id={`${glassId}-rim`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: 'var(--hero-glass-rim-light)' }} />
              <stop offset="55%" style={{ stopColor: 'var(--hero-glass-rim-mid)' }} />
              <stop offset="100%" style={{ stopColor: 'var(--hero-glass-rim-light)' }} />
            </linearGradient>
            <mask id={`${glassId}-crescent`}>
              <circle cx="100" cy="100" r="92" fill="#fff" />
              <circle cx="104.5" cy="106" r="92" fill="#000" />
            </mask>
            <filter id={`${glassId}-soft`} x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="1.4" />
            </filter>
          </defs>
          <circle cx="100" cy="100" r="99" style={{ fill: 'var(--hero-tank-bg)', stroke: 'var(--hero-tank-border)' }} strokeWidth="2" />
          <g clipPath={`url(#${clipId})`}>
            <g className="water-hero__level" style={{ transform: `translateY(${levelY}px)` }}>
              <g className="water-hero__wave-track water-hero__wave-track--back" opacity="0.45">
                <path className="water-hero__wave" d={wavePath(amplitude * 0.8)} style={{ fill: 'var(--water-top)' }} transform="translate(-25 3)" />
              </g>
              {/* Drawn between the wave layers so the front wave covers its belly: it swims rather than floats */}
              {remainingRatio > 0 && (
                <g transform="translate(98 -9) rotate(-8) scale(0.56)">
                  <Dolphin />
                </g>
              )}
              <g className="water-hero__wave-track">
                <path className="water-hero__wave" d={wavePath(amplitude)} fill={`url(#${gradientId})`} opacity="0.92" />
              </g>
              {BUBBLES.slice(0, bubbleCount).map(bubble => (
                <circle
                  key={bubble.x}
                  className="water-hero__bubble"
                  cx={bubble.x}
                  cy="130"
                  r={bubble.size}
                  fill="rgba(255, 255, 255, 0.75)"
                  style={{ '--bubble-delay': `${bubble.delay}s`, '--bubble-duration': `${bubble.duration}s` }}
                />
              ))}
            </g>
          </g>
          <circle cx="100" cy="100" r="94" fill={`url(#${glassId}-depth)`} />
          <circle cx="100" cy="100" r="92" fill={`url(#${glassId}-sheen)`} mask={`url(#${glassId}-crescent)`} filter={`url(#${glassId}-soft)`} />
          <ellipse cx="58" cy="50" rx="9" ry="3.6" transform="rotate(-42 58 50)" style={{ fill: 'var(--hero-glass-glint)' }} filter={`url(#${glassId}-soft)`} />
          <circle cx="100" cy="100" r="94" fill="none" stroke={`url(#${glassId}-rim)`} strokeWidth="1.5" />
        </svg>
        {/* Above the waterline the readout sits on the card background, so it follows the theme's text colour */}
        <div className={`water-hero__readout${levelY > 92 ? ' water-hero__readout--dry' : ''}`}>
          <span className="water-hero__percent">{remainingPercent.toFixed(0)}<small>%</small></span>
          <span className="water-hero__percent-label">남음</span>
        </div>
      </div>

      <div className="water-hero__body">
        <div className="water-hero__eyebrow">
          <b>{profile?.name || '데이터 요금제'}</b>
          <span>월 {limitGB} GB · 매월 {resetDay}일 리셋</span>
          {onOpenCalibration && (
            <button type="button" className="water-hero__edit" onClick={onOpenCalibration} aria-label="요금제 정보와 사용량 보정">
              <Edit3 size={13} />
              <span>보정</span>
            </button>
          )}
        </div>

        <div className="water-hero__remaining">
          <strong>{formatGB(forecast.remainingGB)} GB</strong>
          <span>남음 · {formatGB(forecast.usedGB)} / {limitGB} GB 사용</span>
        </div>

        <div>
          <p className="water-hero__headline">{headline}</p>
          <p className="water-hero__sub">{sub}</p>
        </div>

        {forecast.status !== 'exhausted' && (
          <div className="water-hero__today">
            <div className="water-hero__today-row">
              <span>{todayMessage}</span>
              <span>오늘 {formatGB(forecast.todayUsedGB)} / {formatGB(forecast.todayBudgetGB)} GB</span>
            </div>
            <div className="water-hero__meter" aria-hidden="true">
              <div style={{ width: `${todayRatio * 100}%`, background: forecast.todayLeftGB < 0 ? 'var(--accent-rose)' : undefined }} />
            </div>
          </div>
        )}

        <div>
          <BurnChart forecast={forecast} accent="var(--hero-accent)" />
          <div className="water-hero__chart-labels">
            <span>{formatShortDate(forecast.start)} 시작</span>
            <span>점선: 지금 속도의 예상 · 회색선: 한도</span>
            <span>{formatShortDate(forecast.end)} 리셋</span>
          </div>
        </div>
      </div>
    </section>
  );
}
