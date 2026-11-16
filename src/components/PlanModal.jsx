import React, { memo, useId, useRef, useState } from 'react';
import { Check, RefreshCw, Smartphone, Sparkles, X } from 'lucide-react';
import { detectLteRouterCarrier } from '../services/routerDetectionService';
import { getBillingPeriod } from '../services/storageService';
import { describePlan, parsePlanName } from '../utils/planName';
import useModalA11y from '../hooks/useModalA11y';
import './PlanModal.css';

const SPEED_PRESETS = [1, 3, 5, 10];
const toNumber = (value, fallback = 0) => {
  const number = parseFloat(value);
  return Number.isFinite(number) ? number : fallback;
};
const trimNumber = value => String(Math.round(value * 100) / 100);

// One window for adding a plan and editing it. Pasting the marketed plan name fills the
// structure (monthly data, daily top-up, what happens after), and current usage can be
// entered as the "remaining" figure carrier apps show.
function PlanModal({ profile = null, currentUsedGB = 0, networkBindings = [], onSave, onClose }) {
  const isNew = !profile;
  const dialogRef = useRef(null);
  const titleId = useId();
  useModalA11y(dialogRef, onClose);

  const [name, setName] = useState(profile?.name || '');
  const [carrier, setCarrier] = useState(profile?.carrierName || '');
  const [monthly, setMonthly] = useState(profile ? trimNumber(profile.monthlyLimitGB || 0) : '');
  const [daily, setDaily] = useState(trimNumber(profile?.dailyBonusGB || 0));
  const [afterLimit, setAfterLimit] = useState(profile?.afterLimit === 'throttled' ? 'throttled' : 'blocked');
  const [speed, setSpeed] = useState(profile?.throttleMbps ? trimNumber(profile.throttleMbps) : '3');
  const [resetDay, setResetDay] = useState(String(profile?.resetDay || 1));
  const [usageMode, setUsageMode] = useState('remaining');
  const [usageInput, setUsageInput] = useState('');
  const [guessed, setGuessed] = useState([]);
  const [recognized, setRecognized] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState('');
  // Fields the user typed themselves are never overwritten by name recognition.
  const touched = useRef(new Set());
  const touch = field => touched.current.add(field);

  const applyName = value => {
    setName(value);
    const parsed = parsePlanName(value);
    const fill = (field, setter, next) => {
      if (next === undefined || touched.current.has(field)) return;
      setter(next);
    };
    if (parsed.carrierName) fill('carrier', setCarrier, parsed.carrierName);
    fill('monthly', setMonthly, parsed.monthlyLimitGB !== undefined ? trimNumber(parsed.monthlyLimitGB) : undefined);
    fill('daily', setDaily, parsed.dailyBonusGB !== undefined ? trimNumber(parsed.dailyBonusGB) : parsed.afterLimit ? '0' : undefined);
    fill('afterLimit', setAfterLimit, parsed.afterLimit);
    fill('speed', setSpeed, parsed.throttleMbps !== undefined ? trimNumber(parsed.throttleMbps) : undefined);
    setGuessed(parsed.guessed.filter(field => !touched.current.has(field === 'throttleMbps' ? 'speed' : 'daily')));
    setRecognized(parsed.monthlyLimitGB !== undefined
      ? describePlan({ ...parsed, dailyBonusGB: parsed.dailyBonusGB || 0 })
      : '');
  };

  const plan = {
    monthlyLimitGB: Math.max(0.1, toNumber(monthly, 0)),
    dailyBonusGB: Math.max(0, toNumber(daily, 0)),
    afterLimit,
    throttleMbps: afterLimit === 'throttled' ? Math.max(0, toNumber(speed, 0)) : 0
  };
  const monthlyValid = toNumber(monthly, 0) > 0;

  // Usage is entered either as what is left (carrier apps show this) or what was used.
  const enteredUsage = usageInput.trim() === '' ? null : Math.max(0, toNumber(usageInput, 0));
  const usedGB = enteredUsage === null
    ? (isNew ? 0 : currentUsedGB)
    : usageMode === 'remaining' ? Math.max(0, plan.monthlyLimitGB - enteredUsage) : enteredUsage;
  const summary = describePlan(plan);

  const handleDetect = async () => {
    setScanning(true);
    setScanMessage('');
    try {
      const result = await detectLteRouterCarrier();
      if (result.detected && result.carrierName && !touched.current.has('carrier')) setCarrier(result.carrierName);
      setScanMessage(result.message || (result.detected ? '라우터를 찾았습니다.' : '라우터를 찾지 못했습니다.'));
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : '라우터 검색 중 오류가 발생했습니다.');
    } finally {
      setScanning(false);
    }
  };

  const handleSubmit = event => {
    event.preventDefault();
    if (!monthlyValid) return;
    const day = Math.min(31, Math.max(1, parseInt(resetDay, 10) || 1));
    const data = {
      name: name.trim() || carrier.trim() || '데이터 요금제',
      carrierName: carrier.trim(),
      ...plan,
      resetDay: day,
      lastResetPeriod: getBillingPeriod(day),
      needsRegistration: false
    };
    // Only an entered usage figure recalibrates; editing the plan alone keeps the live count.
    if (isNew || enteredUsage !== null) {
      data.initialBaselineGB = Math.round(usedGB * 1000) / 1000;
      data.sessionBytes = 0;
    }
    onSave(data);
    onClose();
  };

  const handleZeroReset = () => {
    if (!window.confirm('이 요금제의 이번 달 사용량을 0 GB로 초기화할까요?')) return;
    const day = profile?.resetDay || 1;
    onSave({ initialBaselineGB: 0, sessionBytes: 0, lastResetPeriod: getBillingPeriod(day) });
    onClose();
  };

  const guessNote = guessed.length > 0
    ? `${guessed.map(field => (field === 'dailyBonusGB' ? '매일 추가 데이터' : '소진 후 속도')).join('·')}는 이 이름의 일반적인 구성으로 채웠어요. 요금제 안내와 다르면 고쳐 주세요.`
    : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby={titleId} className="modal-panel plan-modal" onClick={event => event.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="닫기"><X size={20} /></button>
        <div className="modal-heading">
          <div className="modal-heading__icon"><Smartphone size={20} /></div>
          <div>
            <h2 id={titleId}>{isNew ? '요금제 추가' : '요금제 정보 · 사용량'}</h2>
            <p>요금제 이름을 붙여 넣으면 데이터 구성을 알아서 채워 드려요.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="plan-modal__form">
          <label className="plan-field">
            <span className="plan-field__label">요금제 이름</span>
            <input
              className="glass-input"
              value={name}
              onChange={event => applyName(event.target.value)}
              placeholder="예: [A모바일]A 스페셜 11GB+"
              data-autofocus
            />
            {recognized && <span className="plan-field__hint plan-field__hint--ok"><Sparkles size={12} /> 인식: {recognized}</span>}
          </label>

          <div className="plan-field">
            <span className="plan-field__label">통신사 · 회선 (선택)</span>
            <div className="plan-field__row">
              <input className="glass-input" value={carrier} onChange={event => { touch('carrier'); setCarrier(event.target.value); }} placeholder="예: A모바일, 회사 에그" aria-label="통신사 또는 회선 이름" />
              <button type="button" className="glass-btn plan-field__side" onClick={handleDetect} disabled={scanning}>
                {scanning ? <RefreshCw size={13} className="spin" /> : <Sparkles size={13} />}
                <span>{scanning ? '검색 중…' : '라우터 검색'}</span>
              </button>
            </div>
            {scanMessage && <span className="plan-field__hint">{scanMessage}</span>}
          </div>

          <div className="plan-grid">
            <label className="plan-field">
              <span className="plan-field__label">매월 기본 데이터</span>
              <div className="plan-field__unit">
                <input className="glass-input" type="number" min="0.1" max="5000" step="0.1" required value={monthly}
                  onChange={event => { touch('monthly'); setMonthly(event.target.value); }} placeholder="11" />
                <span>GB</span>
              </div>
            </label>
            <label className="plan-field">
              <span className="plan-field__label">매일 추가 데이터</span>
              <div className="plan-field__unit">
                <input className="glass-input" type="number" min="0" max="100" step="0.1" value={daily}
                  onChange={event => { touch('daily'); setGuessed(list => list.filter(f => f !== 'dailyBonusGB')); setDaily(event.target.value); }} />
                <span>GB</span>
              </div>
              <span className="plan-field__hint">기본 데이터를 다 쓴 뒤 매일 주는 양, 없으면 0</span>
            </label>
          </div>

          <fieldset className="plan-field plan-choice">
            <legend className="plan-field__label">데이터를 다 쓰면</legend>
            <div className="plan-choice__options">
              {[
                { id: 'throttled', label: '느린 속도로 계속', hint: '"11GB+", "3Mbps" 같은 요금제' },
                { id: 'blocked', label: '차단 · 추가 요금', hint: '한도가 끝인 요금제' }
              ].map(option => (
                <button key={option.id} type="button" className="glass-btn plan-choice__option" aria-pressed={afterLimit === option.id}
                  onClick={() => { touch('afterLimit'); setAfterLimit(option.id); }}>
                  <span>{option.label}</span>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
            {afterLimit === 'throttled' && (
              <div className="plan-speed">
                <span>속도</span>
                {SPEED_PRESETS.map(value => (
                  <button key={value} type="button" className="glass-btn plan-speed__chip" aria-pressed={toNumber(speed) === value}
                    onClick={() => { touch('speed'); setGuessed(list => list.filter(f => f !== 'throttleMbps')); setSpeed(String(value)); }}>
                    {value}Mbps
                  </button>
                ))}
                <div className="plan-field__unit plan-speed__custom">
                  <input className="glass-input" type="number" min="0" max="1000" step="0.1" value={speed} aria-label="소진 후 속도 (Mbps)"
                    onChange={event => { touch('speed'); setGuessed(list => list.filter(f => f !== 'throttleMbps')); setSpeed(event.target.value); }} />
                  <span>Mbps</span>
                </div>
              </div>
            )}
          </fieldset>
          {guessNote && <p className="plan-field__hint plan-field__hint--warn">{guessNote}</p>}

          <div className="plan-grid">
            <label className="plan-field">
              <span className="plan-field__label">매월 리셋일</span>
              <div className="plan-field__unit">
                <input className="glass-input" type="number" min="1" max="31" required value={resetDay} onChange={event => setResetDay(event.target.value)} />
                <span>일</span>
              </div>
            </label>
            <div className="plan-field">
              <span className="plan-field__label">이번 달 사용량 {isNew ? '(선택)' : '맞추기 (선택)'}</span>
              <div className="plan-usage">
                <div className="plan-usage__toggle" role="group" aria-label="사용량 입력 방식">
                  <button type="button" aria-pressed={usageMode === 'remaining'} onClick={() => setUsageMode('remaining')}>남은 양</button>
                  <button type="button" aria-pressed={usageMode === 'used'} onClick={() => setUsageMode('used')}>쓴 양</button>
                </div>
                <div className="plan-field__unit">
                  <input className="glass-input" type="number" min="0" max="100000" step="0.01" value={usageInput}
                    onChange={event => setUsageInput(event.target.value)} aria-label={usageMode === 'remaining' ? '남은 데이터 (GB)' : '사용한 데이터 (GB)'}
                    placeholder={usageMode === 'remaining' ? '통신사 앱의 남은 데이터' : '이번 달 사용한 양'} />
                  <span>GB</span>
                </div>
              </div>
              <span className="plan-field__hint">
                {enteredUsage === null
                  ? (isNew ? '비워 두면 0 GB부터 셉니다.' : `지금 기록: ${trimNumber(currentUsedGB)} GB 사용`)
                  : `저장하면 이번 달 ${trimNumber(usedGB)} GB 사용으로 맞춥니다.`}
              </span>
            </div>
          </div>

          {networkBindings.length > 0 && (
            <p className="plan-field__hint">
              연결된 네트워크: <b>{networkBindings.map(binding => binding.networkName || binding.interfaceName).filter(Boolean).join(', ')}</b> · 변경은 환경 설정에서
            </p>
          )}

          <div className="plan-modal__summary" aria-live="polite">{monthlyValid ? summary : '매월 기본 데이터를 입력해 주세요.'}</div>

          <div className="plan-modal__actions">
            {!isNew && (
              <button type="button" className="plan-modal__reset" onClick={handleZeroReset}>
                <RefreshCw size={13} /><span>0 GB 초기화</span>
              </button>
            )}
            <div className="plan-modal__buttons">
              <button type="button" className="glass-btn" onClick={onClose}>취소</button>
              <button type="submit" className="glass-btn glass-btn-primary" disabled={!monthlyValid}>
                <Check size={16} /><span>{isNew ? '요금제 추가' : '저장'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default memo(PlanModal);
