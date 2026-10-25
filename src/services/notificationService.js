// Notification service for desktop push notifications with per-profile tracking (Tauri & Web fallback)

import { isTauriAvailable } from './networkTelemetry.js';
import { sendNotification, isPermissionGranted, requestPermission } from '@tauri-apps/api/notification';
import { getTodayKey } from './storageService.js';

// Per-profile threshold tracking: { 'profile-1': { t80: false, t90: false, t95: false } }
const profileNotifiedThresholds = {};

const lastDailyNotifiedDateByProfile = {};

export const sendOSNotification = async (title, body) => {
  if (isTauriAvailable()) {
    try {
      let permission = await isPermissionGranted();
      if (!permission) {
        permission = await requestPermission() === 'granted';
      }
      if (permission) {
        sendNotification({ title, body });
        return;
      }
    } catch (e) {
      console.warn('Tauri notification failed, fallback to Web API', e);
    }
  }

  // Web Browser Notification Fallback
  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      new Notification(title, { body });
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          new Notification(title, { body });
        }
      });
    }
  }
};

export const checkAndNotifyDailySurge = (todayGB, dailyLimitGB, profileName, profileId = 'default') => {
  if (!dailyLimitGB || dailyLimitGB <= 0) return;
  const todayStr = getTodayKey();

  if (todayGB >= dailyLimitGB && lastDailyNotifiedDateByProfile[profileId] !== todayStr) {
    lastDailyNotifiedDateByProfile[profileId] = todayStr;
    sendOSNotification(
      `[일일 데이터 초과 경고] ${profileName || '요금제'}`,
      `오늘 하루 설정한 한도(${dailyLimitGB} GB)를 초과했습니다 (현재 ${todayGB.toFixed(2)} GB). 백그라운드 다운로드를 점검하세요.`
    );
  }
};

const THRESHOLD_ALERTS = [
  {
    key: 't95', percent: 95,
    title: name => `[위험 95%] ${name} 한도 긴급 초과`,
    body: usage => `현재 ${usage} 사용 중입니다. 곧 차단되거나 추가 요금이 부과될 수 있습니다.`
  },
  {
    key: 't90', percent: 90,
    title: name => `[경고 90%] ${name} 사용량 위험`,
    body: usage => `현재 ${usage} 사용했습니다. 데이터를 절약해 주세요.`
  },
  {
    key: 't80', percent: 80,
    title: name => `[주의 80%] ${name} 사용량 달성`,
    body: usage => `현재 ${usage} 사용했습니다.`
  }
];

export const checkAndNotifyThresholds = (usedGB, limitGB, carrierName, profileId = 'default', alerts = {}, notify = sendOSNotification) => {
  if (!limitGB || limitGB <= 0) return;
  const percentage = (usedGB / limitGB) * 100;

  if (!profileNotifiedThresholds[profileId]) {
    profileNotifiedThresholds[profileId] = { t80: false, t90: false, t95: false };
  }

  const tracker = profileNotifiedThresholds[profileId];

  // Only the highest crossed level may notify; lower levels are consumed with it so they never follow in reverse order.
  const crossedIndex = THRESHOLD_ALERTS.findIndex(alert => percentage >= alert.percent);
  if (crossedIndex !== -1) {
    const crossed = THRESHOLD_ALERTS.slice(crossedIndex);
    const pending = crossed.find(alert => !tracker[alert.key] && alerts?.[alert.key] !== false);
    crossed.forEach(alert => { tracker[alert.key] = true; });
    if (pending) {
      const usage = `${usedGB.toFixed(1)} GB / ${limitGB} GB (${percentage.toFixed(1)}%)`;
      notify(pending.title(carrierName || '데이터 요금제'), pending.body(usage));
    }
  }

  // Reset notification triggers if usage drops below 75% (e.g. after calibration/reset)
  if (percentage < 75) {
    tracker.t80 = false;
    tracker.t90 = false;
    tracker.t95 = false;
  }
};
