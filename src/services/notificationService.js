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
      `오늘 ${profileName || '요금제'} 데이터를 많이 썼어요`,
      `오늘 ${todayGB.toFixed(2)} GB를 써서 알림 기준 ${dailyLimitGB} GB를 넘었습니다. 자동 업데이트나 클라우드 동기화 같은 백그라운드 다운로드가 있는지 확인해 보세요.`
    );
  }
};

const THRESHOLD_ALERTS = [
  {
    key: 't95', percent: 95,
    title: name => `${name} 데이터 95% 사용`,
    body: usage => `${usage} 사용했습니다. 다 쓰면 차단되거나 추가 요금이 붙을 수 있습니다.`
  },
  {
    key: 't90', percent: 90,
    title: name => `${name} 데이터 90% 사용`,
    body: usage => `${usage} 사용했습니다. 리셋일까지 아껴 쓰는 게 좋겠습니다.`
  },
  {
    key: 't80', percent: 80,
    title: name => `${name} 데이터 80% 사용`,
    body: usage => `${usage} 사용했습니다.`
  }
];

// Plans that only slow down after their monthly data are never "cut off", so their alerts
// say what happens next instead of warning about blocking or extra charges.
const throttledAlert = (alert, plan) => {
  const speed = Number(plan.throttleMbps) > 0 ? `${Number(plan.throttleMbps)}Mbps` : '느린 속도';
  const next = Number(plan.dailyBonusGB) > 0 ? `매일 ${Number(plan.dailyBonusGB)}GB + ${speed}` : speed;
  return {
    title: name => `${name} 기본 데이터 ${alert.percent}% 사용`,
    body: usage => `${usage} 사용했습니다. 다 쓰면 ${next}로 계속 쓸 수 있습니다.`
  };
};

export const checkAndNotifyThresholds = (usedGB, limitGB, carrierName, profileId = 'default', alerts = {}, notify = sendOSNotification, plan = {}) => {
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
      const message = plan?.afterLimit === 'throttled' ? throttledAlert(pending, plan) : pending;
      notify(message.title(carrierName || '데이터 요금제'), message.body(usage));
    }
  }

  // Reset notification triggers if usage drops below 75% (e.g. after calibration/reset)
  if (percentage < 75) {
    tracker.t80 = false;
    tracker.t90 = false;
    tracker.t95 = false;
  }
};
