import React, { useState, useEffect, useRef, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  loadConfig,
  saveConfig,
  getActiveProfile,
  calculateTotalUsedGB,
  getTodayKey,
  addDailyUsageBytes,
  MAX_PROFILES,
  normalizeConfig,
  rolloverBillingCycles
} from './services/storageService';
import {
  fetchCurrentNetworkIdentity,
  fetchRealtimeStats,
  isTauriAvailable,
  relaunchAsAdmin,
  setWindowMiniMode,
  updateTrayTooltip
} from './services/networkTelemetry';
import { disconnectNetworkProfile, getActiveNetworkBinding, reconcileNetworkProfile, updateNetworkBinding } from './services/networkProfileService';
import { advanceNetworkObservation } from './services/networkObservation';
import { diagnosticRecorder } from './services/diagnosticService';
import { checkAndNotifyThresholds, checkAndNotifyDailySurge } from './services/notificationService';
import { formatSpeed } from './utils/formatters';
import Header from './components/Header';
import ProfileTabBar from './components/ProfileTabBar';
import QuickStatsStrip from './components/QuickStatsStrip';
import QuotaRingCard from './components/QuotaRingCard';
import TrafficTimeSeriesChart from './components/TrafficTimeSeriesChart';
import LiveSpeedCard from './components/LiveSpeedCard';
import PingTestCard from './components/PingTestCard';
import AppBreakdownCard from './components/AppBreakdownCard';
import MiniGadget from './components/MiniGadget';
import TitleBar from './components/TitleBar';
import CalibrationModal from './components/CalibrationModal';
import SettingsModal from './components/SettingsModal';
import DailyHistoryModal from './components/DailyHistoryModal';
import NetworkClassificationModal from './components/NetworkClassificationModal';
import UpdateModal from './components/UpdateModal';
import { checkForAppUpdate, installAppUpdate } from './services/updateService';

export default function App() {
  const [config, setConfig] = useState(loadConfig);
  const [telemetry, setTelemetry] = useState({
    downloadSpeed: 0,
    uploadSpeed: 0,
    totalRx: 0,
    totalTx: 0,
    interfaces: [],
    source: 'initializing',
    error: ''
  });
  const [historyData, setHistoryData] = useState([]);
  const [showCalibration, setShowCalibration] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDailyHistory, setShowDailyHistory] = useState(false);
  const [pendingNetworkFingerprint, setPendingNetworkFingerprint] = useState('');
  const [availableUpdate, setAvailableUpdate] = useState(null);
  const [updateStatus, setUpdateStatus] = useState('idle');
  const [updateError, setUpdateError] = useState('');

  // useRef to always hold the latest config without re-creating intervals
  const configRef = useRef(config);
  const lastNetworkFingerprintRef = useRef('');
  const networkObservationRef = useRef({ fingerprint: '', count: 0, confirmed: false });
  const networkDetectionInFlightRef = useRef(false);
  const updateCheckStartedRef = useRef(false);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // Throttled save: persist to localStorage every 10 seconds for high-frequency telemetry
  const pendingSaveRef = useRef(false);

  // Periodic flush: save to localStorage every 10 seconds if there are pending changes
  useEffect(() => {
    const flushInterval = setInterval(() => {
      if (pendingSaveRef.current) {
        saveConfig(configRef.current);
        pendingSaveRef.current = false;
      }
    }, 10000);

    // Also save on unmount/page close
    const handleBeforeUnload = () => {
      saveConfig(configRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(flushInterval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      // Final flush
      saveConfig(configRef.current);
    };
  }, []);

  const activeProfile = getActiveProfile(config);
  const activeNetworkBinding = getActiveNetworkBinding(config);

  // Sync theme attribute to document root element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', config.theme || 'soft-dark');
  }, [config.theme]);

  // Use an in-app Korean update dialog instead of Tauri's default English message box.
  useEffect(() => {
    if (!isTauriAvailable() || updateCheckStartedRef.current) return undefined;
    updateCheckStartedRef.current = true;
    let cancelled = false;

    const timer = setTimeout(async () => {
      try {
        const result = await checkForAppUpdate();
        if (!cancelled && result.shouldUpdate) {
          setAvailableUpdate(result);
          setConfig(prev => {
            if (!prev.miniMode) return prev;
            const updated = { ...prev, miniMode: false };
            saveConfig(updated);
            return updated;
          });
        }
      } catch (error) {
        console.warn('Automatic update check failed', error);
      }
    }, 900);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      updateCheckStartedRef.current = false;
    };
  }, []);

  // Adjust Tauri window size & always-on-top mode dynamically when switching miniMode
  useEffect(() => {
    setWindowMiniMode(config.miniMode);
  }, [config.miniMode]);

  // Detect router/hotspot changes independently from the PC's Wi-Fi adapter.
  // A profile is only switched when the network fingerprint actually changes,
  // so users can still inspect another profile manually while staying connected.
  useEffect(() => {
    if (!isTauriAvailable()) return undefined;

    const syncNetworkProfile = async () => {
      if (networkDetectionInFlightRef.current) return;
      networkDetectionInFlightRef.current = true;
      try {
        const identity = await fetchCurrentNetworkIdentity();
        diagnosticRecorder.observe(identity);
        const observation = advanceNetworkObservation(networkObservationRef.current, identity);
        networkObservationRef.current = observation;
        const fingerprint = observation.fingerprint;
        if (!fingerprint) {
          lastNetworkFingerprintRef.current = '';
          setPendingNetworkFingerprint('');
          setConfig(prev => {
            const disconnected = disconnectNetworkProfile(prev);
            if (disconnected !== prev) saveConfig(disconnected);
            return disconnected;
          });
          return;
        }
        if (!observation.confirmed) return;
        setPendingNetworkFingerprint(previous => previous && previous !== fingerprint ? '' : previous);
        if (fingerprint === lastNetworkFingerprintRef.current) return;

        const resolution = reconcileNetworkProfile(configRef.current, identity);
        const isNewNetwork = resolution.action === 'created';
        if (resolution.replacedFingerprint) {
          setPendingNetworkFingerprint(previous => previous === resolution.replacedFingerprint ? fingerprint : previous);
        }
        lastNetworkFingerprintRef.current = fingerprint;
        setConfig(prev => {
          const result = reconcileNetworkProfile(prev, identity);
          if (result.config === prev) return prev;
          saveConfig(result.config);
          return result.config;
        });
        if (isNewNetwork) {
          setPendingNetworkFingerprint(fingerprint);
        }
      } catch (error) {
        diagnosticRecorder.error();
        console.warn('Network profile detection failed', error);
      } finally {
        networkDetectionInFlightRef.current = false;
      }
    };

    syncNetworkProfile();
    const interval = setInterval(syncNetworkProfile, 5000);
    return () => clearInterval(interval);
  }, []);

  // Listen for Tauri IPC System Tray events ("toggle-mini")
  useEffect(() => {
    let unlisten = null;
    const listenTrayEvents = async () => {
      if (isTauriAvailable()) {
        try {
          unlisten = await listen('toggle-mini', (event) => {
            const isMini = Boolean(event.payload);
            setConfig(prev => {
              const updated = { ...prev, miniMode: isMini };
              saveConfig(updated);
              return updated;
            });
          });
        } catch (e) {
          console.warn(e);
        }
      }
    };
    listenTrayEvents();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Real-time telemetry tick (every 1 second)
  // Uses configRef to always read the latest state without re-creating the interval
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const latestConfig = configRef.current;
        const currentBinding = getActiveNetworkBinding(latestConfig);
        const meteredProfileId = currentBinding?.meteringMode === 'metered'
          ? currentBinding.profileId
          : '';
        const currentProfile = (latestConfig.profiles || []).find(profile => profile.id === meteredProfileId)
          || getActiveProfile(latestConfig);
        const targetInterface = currentBinding?.interfaceName || 'ALL (전체 인터페이스)';
        const stats = await fetchRealtimeStats(targetInterface);
        if (stats) {
          setTelemetry({ ...stats, error: '' });

          // Update System Tray hover tooltip with real-time usage & speed
          const totalGB = calculateTotalUsedGB(currentProfile);
          const limitGB = currentProfile.monthlyLimitGB || 100;
          const pct = ((totalGB / limitGB) * 100).toFixed(1);
          const downStr = formatSpeed(stats.downloadSpeed || 0, latestConfig.unitMode);
          const upStr = formatSpeed(stats.uploadSpeed || 0, latestConfig.unitMode);
          const networkModeLabel = currentBinding?.meteringMode === 'unmetered'
            ? '무제한 네트워크'
            : currentBinding?.meteringMode === 'ignored'
              ? '측정 제외'
              : currentBinding?.meteringMode === 'unclassified'
                ? '분류 필요'
                : `사용량: ${totalGB.toFixed(2)} / ${limitGB} GB (${pct}%)`;
          const trayTooltipText = `돌핀 데이터 [${currentBinding?.networkName || currentProfile.name || '현재 네트워크'}]\n${networkModeLabel}\n실시간: ↓ ${downStr} | ↑ ${upStr}`;
          updateTrayTooltip(trayTooltipText);

          // Accumulate bytes into the active profile's sessionBytes and dailyHistory
          const addedBytes = stats.source === 'native'
            ? (stats.receivedBytes || 0) + (stats.transmittedBytes || 0)
            : 0;
          if (stats.source === 'native') {
            setConfig(prev => {
              const rolledConfig = rolloverBillingCycles(prev);
              if (rolledConfig === prev) return prev;
              pendingSaveRef.current = true;
              return rolledConfig;
            });
          }
          if (addedBytes > 0 && meteredProfileId) {
            setConfig(prev => {
              const rolledConfig = rolloverBillingCycles(prev);
              const stillActive = getActiveNetworkBinding(rolledConfig);
              if (stillActive?.fingerprint !== currentBinding?.fingerprint
                || stillActive?.meteringMode !== 'metered'
                || stillActive.profileId !== meteredProfileId) return rolledConfig;
              const targetProfileId = (rolledConfig.profiles || []).some(profile => profile.id === meteredProfileId)
                ? meteredProfileId
                : '';
              if (!targetProfileId) return rolledConfig;
              let targetProfileName = '요금제';

              const updatedProfiles = (rolledConfig.profiles || []).map(p => {
                if (p.id === targetProfileId) {
                  targetProfileName = p.name;
                  const updatedP = {
                    ...p,
                    sessionBytes: (p.sessionBytes || 0) + addedBytes
                  };
                  // Check threshold push notification for this profile
                  const profileTotalGB = calculateTotalUsedGB(updatedP);
                  checkAndNotifyThresholds(profileTotalGB, updatedP.monthlyLimitGB || 100, updatedP.name, updatedP.id, rolledConfig.alerts);
                  return updatedP;
                }
                return p;
              });

              // Accumulate into dailyHistory
              const todayKey = getTodayKey();
              const configWithDailyUsage = addDailyUsageBytes(rolledConfig, targetProfileId, todayKey, addedBytes);
              const newTodayBytes = configWithDailyUsage.dailyHistoryByProfile[targetProfileId][todayKey];
              const newTodayGB = newTodayBytes / (1024 * 1024 * 1024);

              // Check daily surge limit notification
              if (rolledConfig.alerts?.dailySurge !== false) {
                checkAndNotifyDailySurge(newTodayGB, rolledConfig.dailySurgeLimitGB || 5, targetProfileName, targetProfileId);
              }

              const updatedConfig = {
                ...configWithDailyUsage,
                profiles: updatedProfiles,
              };
              // Mark as pending save (will be flushed every 10s)
              pendingSaveRef.current = true;
              return updatedConfig;
            });
          }

          // Update rolling time-series graph (keep last 60 ticks)
          setHistoryData(prev => {
            const next = [...prev, { downloadSpeed: stats.downloadSpeed, uploadSpeed: stats.uploadSpeed, time: new Date() }];
            if (next.length > 60) next.shift();
            return next;
          });
        }
      } catch (err) {
        console.error('Telemetry tick error in App.jsx', err);
        setTelemetry(prev => ({
          ...prev,
          downloadSpeed: 0,
          uploadSpeed: 0,
          source: 'error',
          error: err instanceof Error ? err.message : String(err)
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  }, []); // Empty dependency array: interval created once, reads configRef for latest state

  // Saves config immediately for user-initiated actions (theme, settings, calibration)
  // Safely merges partial updates whether passed as an object or a function
  const handleUpdateConfig = useCallback((newPartial) => {
    setConfig(prev => {
      const partial = typeof newPartial === 'function' ? newPartial(prev) : newPartial;
      const updated = { ...prev, ...partial };
      saveConfig(updated); // Immediate save for explicit user actions
      return updated;
    });
  }, []);

  const handleRunAsAdmin = useCallback(async ({ configUpdates, bindingUpdates }) => {
    let updated = { ...configRef.current, ...configUpdates };
    if (bindingUpdates) updated = updateNetworkBinding(updated, bindingUpdates);
    configRef.current = updated;
    saveConfig(updated);
    setConfig(updated);
    pendingSaveRef.current = false;
    await relaunchAsAdmin();
  }, []);

  const handleUpdateActiveProfile = useCallback((profilePartial) => {
    setConfig(prev => {
      const updatedProfiles = (prev.profiles || []).map(p => {
        if (p.id === prev.activeProfileId) {
          return { ...p, ...profilePartial };
        }
        return p;
      });
      const updated = { ...prev, profiles: updatedProfiles };
      saveConfig(updated); // Immediate save for explicit user calibration
      return updated;
    });
  }, []);

  const handleSwitchProfile = useCallback((profileId) => {
    setConfig(prev => {
      const updated = { ...prev, activeProfileId: profileId };
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleAddProfile = useCallback((newProfile) => {
    setConfig(prev => {
      if ((prev.profiles || []).length >= MAX_PROFILES) return prev;
      const updatedProfiles = [...(prev.profiles || []), newProfile];
      const updated = { ...prev, profiles: updatedProfiles, activeProfileId: newProfile.id };
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleDeleteProfile = useCallback((profileId) => {
    setConfig(prev => {
      const remaining = (prev.profiles || []).filter(p => p.id !== profileId);
      if (remaining.length === 0) return prev;
      const nextActiveId = prev.activeProfileId === profileId ? remaining[0].id : prev.activeProfileId;
      const updatedBindings = (prev.networkBindings || []).map(binding => binding.profileId === profileId
        ? { ...binding, profileId: '', meteringMode: 'unclassified' }
        : binding);
      const updated = {
        ...prev,
        profiles: remaining,
        networkBindings: updatedBindings,
        activeProfileId: nextActiveId
      };
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleUpdateNetworkBinding = useCallback((bindingPartial) => {
    diagnosticRecorder.classify(bindingPartial, configRef.current);
    setConfig(prev => {
      const updated = updateNetworkBinding(prev, bindingPartial);
      if (updated === prev) return prev;
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleSelectTheme = useCallback((themeName) => {
    setConfig(prev => {
      const updated = { ...prev, theme: themeName };
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleToggleMiniGadget = useCallback(() => {
    setConfig(prev => {
      const updated = { ...prev, miniMode: !prev.miniMode };
      saveConfig(updated);
      return updated;
    });
  }, []);

  const handleCloseNetworkClassification = useCallback(() => {
    if (pendingNetworkFingerprint) {
      setConfig(prev => {
        const mainProfile = (prev.profiles || []).find(p => !p.needsRegistration) || prev.profiles?.[0];
        const updated = updateNetworkBinding(prev, {
          fingerprint: pendingNetworkFingerprint,
          meteringMode: 'unclassified',
          profileId: mainProfile?.id || ''
        });
        if (updated === prev) return prev;
        saveConfig(updated);
        return updated;
      });
    }
    setPendingNetworkFingerprint('');
  }, [pendingNetworkFingerprint]);

  const handleOpenCalibrationFromMini = useCallback(() => {
    setConfig(prev => {
      const updated = { ...prev, miniMode: false };
      saveConfig(updated);
      return updated;
    });
    setShowCalibration(true);
  }, []);

  const handleInstallUpdate = useCallback(async () => {
    setUpdateStatus('installing');
    setUpdateError('');
    try {
      await installAppUpdate();
      setUpdateStatus('restarting');
    } catch (error) {
      console.error('Update installation failed', error);
      setUpdateStatus('error');
      setUpdateError(String(error || 'update failed'));
    }
  }, []);

  const handleCloseUpdate = useCallback(() => {
    if (updateStatus === 'installing' || updateStatus === 'restarting') return;
    setAvailableUpdate(null);
    setUpdateError('');
    setUpdateStatus('idle');
  }, [updateStatus]);

  // Render Always-on-top Mini Gadget View if miniMode is active
  if (config.miniMode) {
    return (
      <div style={{ width: '100vw', height: '100vh', background: 'transparent', overflow: 'hidden', padding: 0, margin: 0 }}>
        <MiniGadget
          config={config}
          telemetry={telemetry}
          onExpand={handleToggleMiniGadget}
          onOpenCalibration={handleOpenCalibrationFromMini}
        />
      </div>
    );
  }

  // Render Main Full Dashboard View
  return (
    <div className="app-window-container">
      
      {/* Top Fixed TitleBar with Window Controls at Top Right */}
      <TitleBar title="돌핀 데이터 (Dolphin Data)" />

      {/* Scrollable Dashboard Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 20px' }}>
        
        {/* Top Header */}
        <Header
          config={config}
          activeProfile={activeProfile}
          networkBinding={activeNetworkBinding}
          onOpenDailyHistory={() => setShowDailyHistory(true)}
          onOpenSettings={() => setShowSettings(true)}
          onToggleMiniGadget={handleToggleMiniGadget}
          onSelectTheme={handleSelectTheme}
          telemetry={telemetry}
        />

        {/* Network-aware multi-profile tab switcher */}
        <ProfileTabBar
          config={config}
          onSwitchProfile={handleSwitchProfile}
          onAddProfile={handleAddProfile}
          onDeleteProfile={handleDeleteProfile}
          onOpenCalibration={() => setShowCalibration(true)}
        />

        {/* Top Quick Stats Bar */}
        <QuickStatsStrip
          telemetry={telemetry}
          config={config}
          activeProfile={activeProfile}
          networkBinding={activeNetworkBinding}
        />

        {/* 2-Column Responsive Dashboard Layout */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(460px, 1fr))',
          gap: '18px',
          alignItems: 'start'
        }}>
          
          {/* Left Column: Data Quota & Rolling Traffic Graph */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <QuotaRingCard
              profile={activeProfile}
              config={config}
              networkBinding={activeNetworkBinding}
              onOpenNetworkSettings={() => setShowSettings(true)}
              onOpenCalibration={() => setShowCalibration(true)}
            />
            <TrafficTimeSeriesChart
              historyData={historyData}
              unitMode={config.unitMode}
              profile={activeNetworkBinding}
            />
          </div>

          {/* Right Column: Speed Meters, Latency Ping, App Usage */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            <LiveSpeedCard
              telemetry={telemetry}
              unitMode={config.unitMode}
            />
            <PingTestCard profile={activeNetworkBinding} />
            <AppBreakdownCard
            />
          </div>

        </div>

      </div>

      {/* Modals */}
      {showCalibration && (
        <CalibrationModal
          profile={activeProfile}
          networkBindings={(config.networkBindings || []).filter(binding => binding.profileId === activeProfile.id)}
          onSave={handleUpdateActiveProfile}
          onClose={() => setShowCalibration(false)}
        />
      )}

      {showDailyHistory && (
        <DailyHistoryModal
          config={config}
          activeProfile={activeProfile}
          onClose={() => setShowDailyHistory(false)}
        />
      )}

      {showSettings && (
        <SettingsModal
          config={config}
          activeProfile={activeProfile}
          networkBinding={activeNetworkBinding}
          onSave={handleUpdateConfig}
          onRunAsAdmin={handleRunAsAdmin}
          onSaveNetworkBinding={handleUpdateNetworkBinding}
          onImportConfig={(newConfig) => {
            const normalized = rolloverBillingCycles(normalizeConfig(newConfig));
            setConfig(normalized);
            saveConfig(normalized);
          }}
          onClose={() => setShowSettings(false)}
        />
      )}

      {pendingNetworkFingerprint && (
        <NetworkClassificationModal
          binding={(config.networkBindings || []).find(binding => binding.fingerprint === pendingNetworkFingerprint)}
          profiles={config.profiles || []}
          onSave={handleUpdateNetworkBinding}
          onClose={handleCloseNetworkClassification}
          onSaved={() => setPendingNetworkFingerprint('')}
        />
      )}

      {availableUpdate && (
        <UpdateModal
          update={availableUpdate}
          status={updateStatus}
          error={updateError}
          onInstall={handleInstallUpdate}
          onClose={handleCloseUpdate}
        />
      )}

    </div>
  );
}
