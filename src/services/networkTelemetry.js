// Telemetry service bridging Tauri Rust IPC and a non-persistent browser preview.

import { invoke as tauriInvoke } from '@tauri-apps/api/tauri';

export const isTauriAvailable = () => {
  return typeof window !== 'undefined' && (Boolean(window.__TAURI__) || Boolean(window.__TAURI_IPC__));
};

let simState = {
  totalRx: 1024 * 1024 * 500, // 500 MB base
  totalTx: 1024 * 1024 * 120, // 120 MB base
};

export const getTauriInvoke = async () => {
  if (typeof window !== 'undefined') {
    if (window.__TAURI__?.tauri?.invoke) {
      return window.__TAURI__.tauri.invoke;
    }
    if (window.__TAURI__?.invoke) {
      return window.__TAURI__.invoke;
    }
  }
  return isTauriAvailable() ? tauriInvoke : null;
};

export const setWindowMiniMode = async (mini) => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        return await invoke('set_mini_mode', { mini: Boolean(mini) });
      }
    } catch (e) {
      console.warn('Failed to set mini mode via Tauri', e);
    }
  }
  return false;
};

export const updateTrayTooltip = async (tooltipText) => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        return await invoke('update_tray_tooltip', { tooltip: String(tooltipText) });
      }
    } catch (e) {
      console.warn('Failed to update tray tooltip via Tauri', e);
    }
  }
};

export const setAutoStart = async (enable) => {
  if (isTauriAvailable()) {
    const invoke = await getTauriInvoke();
    if (!invoke) throw new Error('Tauri IPC를 사용할 수 없습니다.');
    return await invoke('set_auto_start', { enable: Boolean(enable) });
  }
  return false;
};

export const getAutoStart = async () => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        return await invoke('get_auto_start');
      }
    } catch (e) {
      console.warn('Failed to get auto start via Tauri', e);
    }
  }
  return false;
};

export const isRunningAsAdmin = async () => {
  const invoke = await getTauriInvoke();
  if (!invoke) return false;
  return invoke('is_running_as_admin');
};

export const relaunchAsAdmin = async () => {
  const invoke = await getTauriInvoke();
  if (!invoke) throw new Error('관리자 권한 실행은 설치된 Windows 앱에서만 사용할 수 있습니다.');
  return invoke('relaunch_as_admin');
};

export const fetchRealtimeStats = async (targetInterface = 'ALL (전체 인터페이스)') => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        const data = await invoke('get_realtime_stats', { targetInterface });
        if (data) {
          return {
            downloadSpeed: data.download_bytes_sec,
            uploadSpeed: data.upload_bytes_sec,
            receivedBytes: data.rx_delta_bytes,
            transmittedBytes: data.tx_delta_bytes,
            sampleIntervalMs: data.sample_interval_ms,
            totalRx: data.total_rx_bytes,
            totalTx: data.total_tx_bytes,
            source: 'native',
            interfaces: data.interfaces.map(i => ({
              name: i.name,
              rxBytes: i.rx_bytes,
              txBytes: i.tx_bytes,
              receivedBytes: i.rx_delta_bytes,
              transmittedBytes: i.tx_delta_bytes
            }))
          };
        }
      }
    } catch (e) {
      throw new Error(`네이티브 네트워크 계측에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`);
    }

    throw new Error('네이티브 네트워크 계측 응답이 비어 있습니다.');
  }

  // Browser-only preview. App.jsx never persists these simulated values.
  const time = Date.now() / 1000;
  const isSurge = Math.sin(time / 8) > 0.6;
  const baseDown = isSurge ? 3.5 * 1024 * 1024 : 650 * 1024;
  const jitterDown = (Math.sin(time * 2) + Math.cos(time * 3.5)) * 200 * 1024;
  const downloadSpeed = Math.max(25000, Math.floor(baseDown + jitterDown));

  const baseUp = isSurge ? 450 * 1024 : 85 * 1024;
  const jitterUp = Math.cos(time * 2.5) * 40 * 1024;
  const uploadSpeed = Math.max(5000, Math.floor(baseUp + jitterUp));

  simState.totalRx += downloadSpeed;
  simState.totalTx += uploadSpeed;

  return {
    downloadSpeed,
    uploadSpeed,
    receivedBytes: downloadSpeed,
    transmittedBytes: uploadSpeed,
    sampleIntervalMs: 1000,
    totalRx: simState.totalRx,
    totalTx: simState.totalTx,
    source: 'simulation',
    interfaces: [
      { name: 'Ethernet 2 (USB 모바일 라우터)', rxBytes: simState.totalRx, txBytes: simState.totalTx },
      { name: 'Wi-Fi', rxBytes: 1024 * 1024 * 40, txBytes: 1024 * 1024 * 10 }
    ]
  };
};

export const fetchTopProcesses = async () => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        const snapshot = await invoke('get_top_processes');
        if (snapshot && Array.isArray(snapshot.processes)) {
          return {
            source: snapshot.source || 'unavailable',
            error: snapshot.error || null,
            processes: snapshot.processes.map(p => ({
            pid: p.pid,
            name: p.name,
            downloadBytesPerSec: p.download_bytes_per_sec,
            uploadBytesPerSec: p.upload_bytes_per_sec,
            sessionDownloadBytes: p.session_download_bytes,
            sessionUploadBytes: p.session_upload_bytes,
            cpuPercent: p.cpu_percent,
            memoryBytes: p.memory_bytes
            }))
          };
        }
      }
    } catch (e) {
      console.warn('Tauri get_top_processes failed', e);
    }
  }

  return {
    source: 'unavailable',
    error: '프로세스별 네트워크 사용량은 Windows 데스크톱 앱에서 표시됩니다.',
    processes: []
  };
};

export const terminateProcess = async (pid) => {
  if (isTauriAvailable()) {
    try {
      const invoke = await getTauriInvoke();
      if (invoke) {
        return await invoke('kill_process', { targetPid: Number(pid) });
      }
    } catch (e) {
      console.error('Tauri terminateProcess failed', e);
    }
  }
  return false;
};

export const fetchCurrentNetworkIdentity = async () => {
  const invoke = await getTauriInvoke();
  if (!invoke) {
    return {
      connected: false,
      fingerprint: '',
      identityKind: '',
      networkName: '',
      interfaceName: '',
      interfaceDescription: '',
      connectionType: ''
    };
  }
  return invoke('get_current_network_identity');
};

export const runPingTest = async (host = '8.8.8.8') => {
  if (isTauriAvailable()) {
    const invoke = await getTauriInvoke();
    if (!invoke) throw new Error('Tauri IPC를 사용할 수 없습니다.');
    const pingMs = await invoke('run_ping_test', { host: String(host) });
    return { pingMs: Number(pingMs) };
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    await fetch(`https://${host}/favicon.ico?_t=${Date.now()}`, {
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });
  } catch (e) {
    throw new Error(`네트워크 응답을 받지 못했습니다: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timeoutId);
  }
  return { pingMs: Math.max(1, Math.round(performance.now() - start)) };
};
