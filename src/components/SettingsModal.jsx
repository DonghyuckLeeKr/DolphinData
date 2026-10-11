import React, { useState, useEffect, useRef, memo } from 'react';
import { X, Check, Settings, Download, Upload, FileText, Power, Wifi, Info, Mail, ShieldCheck } from 'lucide-react';
import { open } from '@tauri-apps/api/shell';
import { setAutoStart, getAutoStart, isRunningAsAdmin, isTauriAvailable } from '../services/networkTelemetry';
import { getInstalledAppVersion } from '../services/updateService';
import { getNetworkDisplayInfo } from '../utils/networkDisplay';
import { buildSupportMailto, SUPPORT_EMAIL } from '../utils/appMetadata';
import { MAX_BACKUP_FILE_BYTES, parseBackupConfig } from '../services/backupService';
import { createCsvRow } from '../utils/csvSecurity';

function SettingsModal({
  config,
  activeProfile,
  networkBinding,
  onSave,
  onRunAsAdmin,
  onSaveNetworkBinding,
  onImportConfig,
  onClose
}) {
  const [meteringMode, setMeteringMode] = useState(networkBinding?.meteringMode || 'unclassified');
  const [boundProfileId, setBoundProfileId] = useState(networkBinding?.profileId || activeProfile?.id || '');
  const [unitMode, setUnitMode] = useState(config?.unitMode || 'MBs');
  const [autoStartEnabled, setAutoStartEnabled] = useState(Boolean(config?.autoStart));
  const [runningAsAdmin, setRunningAsAdmin] = useState(false);
  const [relaunchingAsAdmin, setRelaunchingAsAdmin] = useState(false);
  const [adminLaunchError, setAdminLaunchError] = useState('');
  const [appVersion, setAppVersion] = useState('확인 중');
  const [dailySurgeLimit, setDailySurgeLimit] = useState(
    config?.dailySurgeLimitGB !== undefined ? String(config.dailySurgeLimitGB) : '5'
  );
  const fileInputRef = useRef(null);

  useEffect(() => {
    let isMounted = true;
    getAutoStart().then(enabled => {
      if (isMounted) {
        setAutoStartEnabled(Boolean(enabled));
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    isRunningAsAdmin()
      .then(elevated => { if (isMounted) setRunningAsAdmin(Boolean(elevated)); })
      .catch(error => console.warn('Failed to check administrator status', error));
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!isTauriAvailable()) {
      setAppVersion('개발 버전');
      return undefined;
    }
    let isMounted = true;
    getInstalledAppVersion()
      .then(version => {
        if (isMounted) setAppVersion(version || '알 수 없음');
      })
      .catch(error => {
        console.warn('Failed to read application version', error);
        if (isMounted) setAppVersion('알 수 없음');
      });
    return () => {
      isMounted = false;
    };
  }, []);

  const handleOpenSupportEmail = async () => {
    const mailto = buildSupportMailto(appVersion);
    try {
      await open(mailto);
    } catch (error) {
      console.warn('Failed to open the default mail application', error);
      window.location.href = mailto;
    }
  };

  const persistSettings = async (relaunch = false) => {
    const actualAutoStart = await setAutoStart(autoStartEnabled);
    if (actualAutoStart !== autoStartEnabled) {
      throw new Error('운영체제 자동 시작 설정이 요청한 상태로 변경되지 않았습니다.');
    }

    const bindingUpdates = networkBinding ? {
      meteringMode,
      profileId: meteringMode === 'metered' ? boundProfileId : (networkBinding.profileId || boundProfileId)
    } : null;
    const configUpdates = {
      unitMode,
      autoStart: autoStartEnabled,
      dailySurgeLimitGB: Math.max(0.5, parseFloat(dailySurgeLimit) || 5)
    };
    if (!relaunch) {
      if (onSaveNetworkBinding && bindingUpdates) onSaveNetworkBinding(bindingUpdates);
      if (onSave) onSave(configUpdates);
    }
    return { configUpdates, bindingUpdates };
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      await persistSettings();
      onClose();
    } catch (error) {
      alert(`설정을 저장하지 못했습니다.\n${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleRunAsAdmin = async () => {
    if (!onRunAsAdmin || relaunchingAsAdmin || runningAsAdmin) return;
    setAdminLaunchError('');
    setRelaunchingAsAdmin(true);
    try {
      const settings = await persistSettings(true);
      await onRunAsAdmin(settings);
    } catch (error) {
      setAdminLaunchError(error instanceof Error ? error.message : String(error));
    } finally {
      setRelaunchingAsAdmin(false);
    }
  };

  // Export CSV with UTF-8 BOM (\uFEFF) to fix Excel Korean character encoding
  const handleExportCSV = () => {
    const profiles = config?.profiles || (activeProfile ? [activeProfile] : []);
    const now = new Date().toISOString();
    
    let csvString = `${createCsvRow([
      '측정일시',
      '프로필명',
      '통신사',
      '기본보정량(GB)',
      '실시간누적(GB)',
      '총사용량(GB)',
      '월간한도(GB)',
      '소진율(%)',
      '리셋일',
      '연결네트워크',
      '과금분류'
    ])}\n`;
    
    profiles.forEach(p => {
      const baseline = parseFloat(p.initialBaselineGB) || 0;
      const sessionGB = (p.sessionBytes || 0) / (1024 * 1024 * 1024);
      const totalGB = baseline + sessionGB;
      const limit = p.monthlyLimitGB || 100;
      const pct = ((totalGB / limit) * 100).toFixed(1);
      
      const profileBindings = (config?.networkBindings || []).filter(binding => binding.profileId === p.id);
      const networkNames = profileBindings.map(binding => binding.networkName).filter(Boolean).join(' | ') || '없음';
      const meteringModes = [...new Set(profileBindings.map(binding => binding.meteringMode))].join(' | ') || '없음';

      csvString += `${createCsvRow([
        now,
        p.name || '',
        p.carrierName || '',
        baseline.toFixed(2),
        sessionGB.toFixed(2),
        totalGB.toFixed(2),
        limit,
        `${pct}%`,
        `매월 ${p.resetDay || 1}일`,
        networkNames,
        meteringModes
      ])}\n`;
    });

    const blob = new Blob(["\uFEFF" + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `돌핀데이터_사용기록_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const networkDisplay = getNetworkDisplayInfo(networkBinding || {});
  const modeDescriptions = {
    metered: '이 네트워크의 송수신량을 선택한 요금제에 누적합니다.',
    unmetered: '집·회사 Wi-Fi처럼 한도 차감 없이 실시간 속도만 표시합니다.',
    ignored: '이 네트워크는 사용량 누적에서 제외합니다.',
    unclassified: '아직 분류하지 않았습니다. 분류 전에는 사용량을 누적하지 않습니다.'
  };
  const displayedAppVersion = /^\d+\.\d+\.\d+/.test(appVersion) ? `v${appVersion}` : appVersion;

  // Export Full JSON Configuration Backup
  const handleExportJSON = () => {
    const exportData = {
      version: "1.2.0",
      exportDate: new Date().toISOString(),
      config: config
    };
    const jsonString = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dolphindata_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Import JSON Configuration Backup
  const handleImportJSON = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    if (file.size > MAX_BACKUP_FILE_BYTES) {
      alert('백업 파일은 1MB 이하여야 합니다.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedConfig = parseBackupConfig(event.target?.result);

        if (onImportConfig) {
          onImportConfig(importedConfig);
        }
        alert('설정 및 프로필 데이터를 성공적으로 불러왔습니다.');
        onClose();
      } catch (err) {
        console.error('Failed to import backup json', err);
        alert(`설정 파일을 불러올 수 없습니다.\n${err instanceof Error ? err.message : '올바른 JSON 파일인지 확인하세요.'}`);
      }
    };
    reader.readAsText(file);
  };

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
          maxWidth: '520px',
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
        
        {/* Top Close Button */}
        <button
          type="button"
          onClick={onClose}
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
            <Settings size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: '700', color: 'var(--text-main)' }}>환경 설정 & 데이터 백업</h2>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              자동 실행, 네트워크별 과금 방식, 일일 경고 및 백업/복원을 관리합니다.
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          
          {/* Windows Auto-Start Toggle Row */}
          <div
            onClick={() => setAutoStartEnabled(prev => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 14px',
              background: 'var(--glass-card)',
              border: '1px solid var(--glass-border-light)',
              borderRadius: '10px',
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Power size={18} color="var(--brand-color)" />
              <div>
                <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-main)', display: 'block' }}>
                  윈도우 부팅 시 자동 실행
                </span>
                <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  PC 시작 시 시스템 트레이에 백그라운드로 자동 실행됩니다.
                </span>
              </div>
            </div>

            <input
              type="checkbox"
              checked={autoStartEnabled}
              onChange={(e) => setAutoStartEnabled(e.target.checked)}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '18px', height: '18px', accentColor: 'var(--brand-color)', cursor: 'pointer' }}
            />
          </div>

          {/* Optional elevation for process-level network diagnostics */}
          <div style={{ padding: '12px 14px', background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)', borderRadius: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
              <ShieldCheck size={18} color="var(--brand-color)" />
              <div>
                <span style={{ display: 'block', fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-main)' }}>관리자 권한 실행</span>
                <span style={{ display: 'block', fontSize: '0.73rem', color: 'var(--text-muted)' }}>
                  부팅 시에는 일반 권한으로 실행됩니다. 필요할 때만 Windows의 권한 확인 후 다시 엽니다.
                </span>
              </div>
            </div>
            <button
              type="button"
              className="glass-btn"
              onClick={handleRunAsAdmin}
              disabled={!isTauriAvailable() || runningAsAdmin || relaunchingAsAdmin}
              style={{ minHeight: '44px', width: '100%', justifyContent: 'center', cursor: runningAsAdmin || relaunchingAsAdmin ? 'default' : 'pointer' }}
            >
              <ShieldCheck size={16} />
              <span>{runningAsAdmin ? '현재 관리자 권한으로 실행 중' : relaunchingAsAdmin ? 'Windows 권한 확인 대기 중…' : '관리자 권한으로 다시 실행'}</span>
            </button>
            {adminLaunchError && <p role="alert" style={{ margin: '8px 0 0', fontSize: '0.76rem', color: 'var(--accent-red, #f87171)' }}>{adminLaunchError}</p>}
          </div>

          {/* Daily Surge Limiter */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              일일 데이터 폭주 방지 경고 한도 (GB)
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="number"
                step="0.5"
                min="0.5"
                max="100"
                value={dailySurgeLimit}
                onChange={(e) => setDailySurgeLimit(e.target.value)}
                className="glass-input"
                style={{ width: '120px' }}
                required
              />
              <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--text-muted)' }}>GB / 일</span>
            </div>
            <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', marginTop: '4px', display: 'block' }}>
              하루에 이 용량을 초과하여 소비할 경우 윈도우 푸시 알림으로 경고합니다.
            </span>
          </div>

          {/* Current network identity and quota mapping */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              현재 네트워크의 사용량 처리
            </label>
            {networkBinding ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Wifi size={16} color="var(--brand-color)" />
                    <b style={{ color: 'var(--text-main)', fontSize: '0.84rem' }}>{networkBinding.networkName || '알 수 없는 네트워크'}</b>
                    <span style={{ color: 'var(--accent-blue)', fontSize: '0.72rem' }}>{networkDisplay.label}</span>
                  </div>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.71rem', display: 'block', marginTop: '4px' }}>
                    자동 선택된 물리 어댑터: {networkBinding.interfaceName || '확인 중'}
                  </span>
                </div>

                <select
                  value={meteringMode}
                  onChange={(e) => setMeteringMode(e.target.value)}
                  className="glass-input"
                  style={{ color: 'var(--text-main)', width: '100%', cursor: 'pointer' }}
                >
                  <option value="unclassified" style={{ background: 'var(--bg-primary)' }}>정보 등록 필요 (누적 보류)</option>
                  <option value="metered" style={{ background: 'var(--bg-primary)' }}>데이터 한도 차감 네트워크</option>
                  <option value="unmetered" style={{ background: 'var(--bg-primary)' }}>무제한 네트워크 (집·회사 Wi-Fi)</option>
                  <option value="ignored" style={{ background: 'var(--bg-primary)' }}>측정 제외</option>
                </select>

                {meteringMode === 'metered' && (
                  <select
                    value={boundProfileId}
                    onChange={(e) => setBoundProfileId(e.target.value)}
                    className="glass-input"
                    style={{ color: 'var(--text-main)', width: '100%', cursor: 'pointer' }}
                    required
                  >
                    {(config?.profiles || []).map(profile => (
                      <option key={profile.id} value={profile.id} style={{ background: 'var(--bg-primary)' }}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                )}

                <span style={{ fontSize: '0.73rem', color: 'var(--text-muted)', display: 'block' }}>
                  {modeDescriptions[meteringMode]}
                </span>
              </div>
            ) : (
              <div style={{ padding: '10px 12px', borderRadius: '10px', background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.28)', color: 'var(--text-muted)', fontSize: '0.75rem' }}>
                연결된 네트워크를 확인 중입니다. 네트워크가 인식되면 여기서 요금제 연결 여부를 지정할 수 있습니다.
              </div>
            )}
          </div>

          {/* Unit Toggle */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              속도 표기 단위
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <button
                type="button"
                onClick={() => setUnitMode('MBs')}
                className="glass-btn"
                style={{
                  justifyContent: 'center',
                  background: unitMode === 'MBs' ? 'var(--brand-badge-bg)' : undefined,
                  borderColor: unitMode === 'MBs' ? 'var(--brand-color)' : undefined,
                  color: unitMode === 'MBs' ? 'var(--brand-color)' : 'var(--text-main)',
                  fontWeight: unitMode === 'MBs' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                MB/s (초당 메가바이트)
              </button>
              <button
                type="button"
                onClick={() => setUnitMode('Mbps')}
                className="glass-btn"
                style={{
                  justifyContent: 'center',
                  background: unitMode === 'Mbps' ? 'var(--brand-badge-bg)' : undefined,
                  borderColor: unitMode === 'Mbps' ? 'var(--brand-color)' : undefined,
                  color: unitMode === 'Mbps' ? 'var(--brand-color)' : 'var(--text-main)',
                  fontWeight: unitMode === 'Mbps' ? 700 : 500,
                  cursor: 'pointer'
                }}
              >
                Mbps (초당 메가비트)
              </button>
            </div>
          </div>

          {/* Backup and Report Controls */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              데이터 백업 및 리포트
            </label>
            
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '8px' }}>
              {/* CSV Report Export */}
              <button
                type="button"
                onClick={handleExportCSV}
                className="glass-btn"
                style={{ justifyContent: 'center', fontSize: '0.78rem', cursor: 'pointer' }}
                title="엑셀에서 한글 깨짐 없이 열 수 있는 CSV 리포트를 내보냅니다."
              >
                <FileText size={14} color="var(--accent-emerald)" />
                <span>CSV 리포트</span>
              </button>

              {/* JSON Settings Export */}
              <button
                type="button"
                onClick={handleExportJSON}
                className="glass-btn"
                style={{ justifyContent: 'center', fontSize: '0.78rem', cursor: 'pointer' }}
                title="모든 요금제 프로필과 설정을 JSON 파일로 백업합니다."
              >
                <Download size={14} color="var(--accent-blue)" />
                <span>설정 내보내기</span>
              </button>
            </div>

            {/* JSON Settings Import */}
            <div>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportJSON}
                accept=".json"
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="glass-btn"
                style={{ width: '100%', justifyContent: 'center', fontSize: '0.78rem', borderColor: 'rgba(167, 139, 250, 0.3)', color: 'var(--accent-purple)', cursor: 'pointer' }}
                title="이전에 백업해 둔 설정(JSON) 파일을 불러와 복원합니다."
              >
                <Upload size={14} />
                <span>설정 파일(.json) 불러오기 및 복원</span>
              </button>
            </div>
          </div>

          {/* Application version and support contact */}
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: '600', color: 'var(--text-main)', display: 'block', marginBottom: '6px' }}>
              앱 정보 및 문의
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '0.8fr 1.4fr', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '9px', minHeight: '54px', padding: '10px 12px', borderRadius: '10px', background: 'var(--glass-card)', border: '1px solid var(--glass-border-light)' }}>
                <Info size={17} color="var(--brand-color)" />
                <div>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.68rem' }}>현재 버전</span>
                  <strong style={{ color: 'var(--text-main)', fontSize: '0.84rem' }}>{displayedAppVersion}</strong>
                </div>
              </div>
              <button
                type="button"
                onClick={handleOpenSupportEmail}
                className="glass-btn"
                aria-label={`문의 메일 보내기: ${SUPPORT_EMAIL}`}
                title="기본 메일 앱으로 문의 메일을 작성합니다."
                style={{ minHeight: '54px', justifyContent: 'flex-start', padding: '10px 12px', cursor: 'pointer', overflow: 'hidden' }}
              >
                <Mail size={17} color="var(--accent-emerald)" style={{ flex: '0 0 auto' }} />
                <span style={{ minWidth: 0, textAlign: 'left' }}>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.68rem', fontWeight: 500 }}>개발자 문의</span>
                  <strong style={{ display: 'block', color: 'var(--text-main)', fontSize: '0.76rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{SUPPORT_EMAIL}</strong>
                </span>
              </button>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px', paddingTop: '14px', borderTop: '1px solid var(--glass-border)' }}>
            <button type="button" onClick={onClose} className="glass-btn" style={{ cursor: 'pointer' }}>
              취소
            </button>
            <button type="submit" className="glass-btn glass-btn-primary" style={{ cursor: 'pointer' }}>
              <Check size={16} />
              <span>설정 저장</span>
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}

export default memo(SettingsModal);
