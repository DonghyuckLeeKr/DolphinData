// Persistent configuration, migrations, and billing-cycle rollover helpers.

const STORAGE_KEY = 'data_usage_counter_v1_config';
const BACKUP_KEY = 'data_usage_counter_v1_backup';
const BYTES_PER_GB = 1024 * 1024 * 1024;
export const MAX_PROFILES = 20;
export const MAX_DAILY_HISTORY_ENTRIES = 1000;
export const MAX_NETWORK_BINDINGS = 100;

const MAX_TEXT_LENGTHS = {
  id: 128,
  name: 100,
  carrierName: 100,
  lastResetPeriod: 32,
  networkFingerprint: 128,
  networkName: 128,
  networkIdentityKind: 32,
  interfaceName: 256,
  interfaceDescription: 256,
  networkConnectionType: 64,
  gatewayIp: 64,
  profileId: 128,
  lastSeenAt: 64,
  icon: 16
};

const ALLOWED_THEMES = new Set(['soft-dark', 'midnight-black', 'nordic-light', 'neon-cyber']);
const ALLOWED_METERING_MODES = new Set(['metered', 'unmetered', 'ignored', 'unclassified']);

export const DEFAULT_PROFILE = {
  id: 'profile-1',
  name: '메인 데이터 요금제',
  carrierName: '모바일 데이터 요금제',
  monthlyLimitGB: 100,
  initialBaselineGB: 0,
  sessionBytes: 0,
  resetDay: 1,
  lastResetPeriod: '',
  profileOrigin: 'manual',
  needsRegistration: false,
  icon: '📱'
};

export const getTodayKey = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const getBillingPeriod = (resetDay = 1, date = new Date()) => {
  const year = date.getFullYear();
  const monthIndex = date.getMonth();
  const day = date.getDate();
  const validResetDay = Math.min(31, Math.max(1, parseInt(resetDay, 10) || 1));
  const lastDayThisMonth = new Date(year, monthIndex + 1, 0).getDate();
  const effectiveResetDay = Math.min(validResetDay, lastDayThisMonth);

  let periodYear = year;
  let periodMonthIndex = monthIndex;
  if (day < effectiveResetDay) {
    periodMonthIndex -= 1;
    if (periodMonthIndex < 0) {
      periodMonthIndex = 11;
      periodYear -= 1;
    }
  }

  return `${periodYear}-${String(periodMonthIndex + 1).padStart(2, '0')}@day${validResetDay}`;
};

export const getCurrentPeriod = () => getBillingPeriod(1);

// Secondary dashboard cards the user may hide. The water-level hero and network prompts always stay.
export const DASHBOARD_CARDS = [
  { id: 'traffic', label: '실시간 트래픽 추이', simple: false },
  { id: 'speed', label: '실시간 전송 속도', simple: true },
  { id: 'ping', label: '네트워크 지연시간 (Ping)', simple: false },
  { id: 'processes', label: '활성 프로세스 리소스', simple: false }
];

export const isDashboardCardVisible = (config, cardId) => {
  const card = DASHBOARD_CARDS.find(option => option.id === cardId);
  if (!card) return true;
  if (config?.dashboardMode === 'simple') return card.simple;
  return !(config?.hiddenCards || []).includes(cardId);
};

const createDefaultConfig = () => ({
  activeProfileId: 'profile-1',
  profiles: [{ ...DEFAULT_PROFILE, lastResetPeriod: getBillingPeriod(1) }],
  unitMode: 'MBs',
  theme: 'soft-dark',
  miniMode: false,
  autoStart: false,
  dailySurgeLimitGB: 5,
  dashboardMode: 'detailed',
  hiddenCards: [],
  dailyHistoryByProfile: {},
  activeNetworkFingerprint: '',
  networkBindings: [],
  alerts: {
    t80: true,
    t90: true,
    t95: true,
    dailySurge: true
  },
  lastUpdated: new Date().toISOString()
});

const normalizeText = (value, fallback, maxLength) => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : fallback;
};

const normalizeNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
};

const normalizeProfileId = (value, fallback) => {
  const id = normalizeText(value, fallback, MAX_TEXT_LENGTHS.id);
  if (!/^[a-zA-Z0-9._:-]+$/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) {
    return fallback;
  }
  return id;
};

const isValidDateKey = (dateKey) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return false;
  const [, year, month, day] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
};

const normalizeNetworkBinding = (binding, profileIds) => {
  const fingerprint = normalizeText(binding?.fingerprint, '', MAX_TEXT_LENGTHS.networkFingerprint);
  if (!fingerprint) return null;
  const profileId = profileIds.has(binding?.profileId)
    ? normalizeText(binding.profileId, '', MAX_TEXT_LENGTHS.profileId)
    : '';
  const fallbackMode = profileId ? 'metered' : 'unclassified';
  const requestedMode = ALLOWED_METERING_MODES.has(binding?.meteringMode)
    ? binding.meteringMode
    : fallbackMode;
  return {
    fingerprint,
    networkName: normalizeText(binding?.networkName, '알 수 없는 네트워크', MAX_TEXT_LENGTHS.networkName),
    identityKind: normalizeText(binding?.identityKind, '', MAX_TEXT_LENGTHS.networkIdentityKind),
    interfaceName: normalizeText(binding?.interfaceName, '', MAX_TEXT_LENGTHS.interfaceName),
    interfaceDescription: normalizeText(binding?.interfaceDescription, '', MAX_TEXT_LENGTHS.interfaceDescription),
    networkConnectionType: normalizeText(
      binding?.networkConnectionType,
      '',
      MAX_TEXT_LENGTHS.networkConnectionType
    ),
    gatewayIp: normalizeText(binding?.gatewayIp, '', MAX_TEXT_LENGTHS.gatewayIp),
    profileId,
    meteringMode: requestedMode === 'metered' && !profileId ? 'unclassified' : requestedMode,
    lastSeenAt: normalizeText(binding?.lastSeenAt, '', MAX_TEXT_LENGTHS.lastSeenAt)
  };
};

const normalizeProfile = (profile, index) => {
  const fallbackId = `profile-${index + 1}`;
  const resetDay = Math.min(31, Math.max(1, parseInt(profile?.resetDay, 10) || 1));
  return {
    id: normalizeProfileId(profile?.id, fallbackId),
    name: normalizeText(profile?.name, `요금제 ${index + 1}`, MAX_TEXT_LENGTHS.name),
    carrierName: normalizeText(profile?.carrierName, '', MAX_TEXT_LENGTHS.carrierName),
    monthlyLimitGB: normalizeNumber(profile?.monthlyLimitGB, 100, 1, 5000),
    initialBaselineGB: normalizeNumber(profile?.initialBaselineGB, 0, 0, 1_000_000),
    sessionBytes: Math.round(normalizeNumber(profile?.sessionBytes, 0, 0, Number.MAX_SAFE_INTEGER)),
    resetDay,
    lastResetPeriod: normalizeText(profile?.lastResetPeriod, '', MAX_TEXT_LENGTHS.lastResetPeriod),
    profileOrigin: profile?.profileOrigin === 'auto-network' ? 'auto-network' : 'manual',
    needsRegistration: Boolean(profile?.needsRegistration),
    icon: normalizeText(profile?.icon, DEFAULT_PROFILE.icon, MAX_TEXT_LENGTHS.icon)
  };
};

const normalizeHistoryEntries = (value, multiplier = 1) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([dateKey, amount]) => {
        const numericAmount = Number(amount);
        return isValidDateKey(dateKey)
          && Number.isFinite(numericAmount)
          && numericAmount >= 0;
      })
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, MAX_DAILY_HISTORY_ENTRIES)
      .map(([dateKey, amount]) => [
        dateKey,
        Math.round(normalizeNumber(Number(amount) * multiplier, 0, 0, Number.MAX_SAFE_INTEGER))
      ])
  );
};

const normalizeDailyHistory = (value, profileIds) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const profileId of profileIds) {
    const history = normalizeHistoryEntries(value[profileId]);
    if (Object.keys(history).length > 0) {
      result[profileId] = history;
    }
  }
  return result;
};

export const normalizeConfig = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('설정 데이터는 JSON 객체여야 합니다.');
  }

  const defaults = createDefaultConfig();
  let profiles;
  if (Array.isArray(input.profiles) && input.profiles.length > 0) {
    profiles = input.profiles.slice(0, MAX_PROFILES).map(normalizeProfile);
  } else if (input.monthlyLimitGB !== undefined || input.carrierName !== undefined) {
    profiles = [normalizeProfile({
      id: 'profile-1',
      name: input.carrierName || '메인 데이터 요금제',
      carrierName: input.carrierName || '모바일 데이터 요금제',
      monthlyLimitGB: input.monthlyLimitGB,
      initialBaselineGB: input.initialBaselineGB,
      sessionBytes: input.sessionBytes,
      resetDay: input.resetDay
    }, 0)];
  } else {
    throw new Error('유효한 요금제 프로필이 없습니다.');
  }

  // Only prune empty placeholders with no network binding. Bound profiles and
  // profiles with usage may represent a separate plan, even with a generic name.
  const boundProfileIds = new Set(Array.isArray(input.networkBindings)
    ? input.networkBindings.map(binding => binding?.profileId)
    : []);
  const hasEstablishedProfile = profiles.some(profile => profile.profileOrigin !== 'auto-network' || !profile.needsRegistration);
  const isGenericAutoPlaceholder = (p) => {
    if (!Array.isArray(input.networkBindings) || !hasEstablishedProfile || boundProfileIds.has(p.id)) return false;
    if (p.profileOrigin !== 'auto-network' || !p.needsRegistration) return false;
    if (p.initialBaselineGB > 0 || p.sessionBytes > 0) return false;
    if (Object.keys(normalizeHistoryEntries(input.dailyHistoryByProfile?.[p.id])).length > 0) return false;
    const cleanName = (p.name || '')
      .replace(/\s*\(정보\s*등록\s*필요\)/gi, '')
      .replace(/\s*\(needs\s*registration\)/gi, '')
      .trim()
      .toLowerCase();
    return (
      !cleanName ||
      cleanName.startsWith('식별 중') ||
      cleanName.startsWith('identifying') ||
      /^네트워크( \d+)?$/.test(cleanName) ||
      /^network( \d+)?$/.test(cleanName) ||
      /^새 네트워크( \d+)?$/.test(cleanName)
    );
  };

  profiles = profiles.filter(profile => !isGenericAutoPlaceholder(profile));

  const profileIds = new Set(profiles.map(profile => profile.id));
  const activeProfileId = profileIds.has(input.activeProfileId) ? input.activeProfileId : profiles[0].id;
  let networkBindings = [];
  if (Array.isArray(input.networkBindings)) {
    const seenFingerprints = new Set();
    networkBindings = input.networkBindings
      .slice(0, MAX_NETWORK_BINDINGS)
      .map(binding => normalizeNetworkBinding(binding, profileIds))
      .filter(binding => {
        if (!binding || seenFingerprints.has(binding.fingerprint)) return false;
        seenFingerprints.add(binding.fingerprint);
        return true;
      });
  } else if (Array.isArray(input.profiles)) {
    networkBindings = input.profiles
      .slice(0, MAX_PROFILES)
      .map((legacyProfile, index) => normalizeNetworkBinding({
        fingerprint: legacyProfile?.networkFingerprint,
        networkName: legacyProfile?.networkName || legacyProfile?.name,
        identityKind: legacyProfile?.networkIdentityKind,
        interfaceName: legacyProfile?.selectedInterface,
        interfaceDescription: legacyProfile?.interfaceDescription,
        networkConnectionType: legacyProfile?.networkConnectionType,
        profileId: profiles[index]?.id,
        meteringMode: 'metered'
      }, profileIds))
      .filter(Boolean);
  }
  const bindingFingerprints = new Set(networkBindings.map(binding => binding.fingerprint));
  const activeNetworkFingerprint = bindingFingerprints.has(input.activeNetworkFingerprint)
    ? input.activeNetworkFingerprint
    : '';
  let dailyHistoryByProfile = normalizeDailyHistory(input.dailyHistoryByProfile, profileIds);

  if (Object.keys(dailyHistoryByProfile).length === 0 && input.dailyHistory && typeof input.dailyHistory === 'object') {
    dailyHistoryByProfile = {
      [activeProfileId]: normalizeHistoryEntries(input.dailyHistory, BYTES_PER_GB)
    };
  }

  return {
    activeProfileId,
    profiles,
    unitMode: input.unitMode === 'Mbps' ? 'Mbps' : 'MBs',
    theme: ALLOWED_THEMES.has(input.theme) ? input.theme : defaults.theme,
    miniMode: Boolean(input.miniMode),
    autoStart: Boolean(input.autoStart),
    dailySurgeLimitGB: normalizeNumber(input.dailySurgeLimitGB, 5, 0.5, 100),
    dashboardMode: input.dashboardMode === 'simple' ? 'simple' : 'detailed',
    hiddenCards: Array.isArray(input.hiddenCards)
      ? [...new Set(input.hiddenCards.filter(card => DASHBOARD_CARDS.some(option => option.id === card)))]
      : [],
    dailyHistoryByProfile,
    activeNetworkFingerprint,
    networkBindings,
    alerts: {
      t80: typeof input.alerts?.t80 === 'boolean' ? input.alerts.t80 : defaults.alerts.t80,
      t90: typeof input.alerts?.t90 === 'boolean' ? input.alerts.t90 : defaults.alerts.t90,
      t95: typeof input.alerts?.t95 === 'boolean' ? input.alerts.t95 : defaults.alerts.t95,
      dailySurge: typeof input.alerts?.dailySurge === 'boolean'
        ? input.alerts.dailySurge
        : defaults.alerts.dailySurge
    },
    lastUpdated: normalizeText(input.lastUpdated, defaults.lastUpdated, 64)
  };
};

export const rolloverBillingCycles = (config, date = new Date()) => {
  let changed = false;
  const profiles = config.profiles.map(profile => {
    const expectedPeriod = getBillingPeriod(profile.resetDay, date);
    if (!profile.lastResetPeriod) {
      changed = true;
      return { ...profile, lastResetPeriod: expectedPeriod };
    }
    if (profile.lastResetPeriod !== expectedPeriod) {
      changed = true;
      return {
        ...profile,
        initialBaselineGB: 0,
        sessionBytes: 0,
        lastResetPeriod: expectedPeriod
      };
    }
    return profile;
  });
  return changed ? { ...config, profiles } : config;
};

export const loadConfig = () => {
  const loadRaw = (raw) => rolloverBillingCycles(normalizeConfig(JSON.parse(raw)));
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const config = loadRaw(raw);
      saveConfig(config);
      return config;
    }
  } catch (error) {
    console.error('Failed to load primary storage config', error);
  }

  try {
    const backupRaw = localStorage.getItem(BACKUP_KEY);
    if (backupRaw) {
      const config = loadRaw(backupRaw);
      saveConfig(config);
      return config;
    }
  } catch (error) {
    console.error('Failed to load backup storage config', error);
  }

  const initial = createDefaultConfig();
  saveConfig(initial);
  return initial;
};

export const saveConfig = (config) => {
  try {
    if (!config || !Array.isArray(config.profiles) || config.profiles.length === 0) {
      console.warn('Blocked attempt to save invalid config with missing profiles:', config);
      return null;
    }
    const updated = { ...config, lastUpdated: new Date().toISOString() };
    delete updated.dailyHistory;
    delete updated.processCumulative;
    const serialized = JSON.stringify(updated);
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(BACKUP_KEY, serialized);
    return updated;
  } catch (error) {
    console.error('Failed to save storage config', error);
    return null;
  }
};

export const getActiveProfile = (config) => {
  if (!Array.isArray(config?.profiles) || config.profiles.length === 0) return DEFAULT_PROFILE;
  return config.profiles.find(profile => profile.id === config.activeProfileId) || config.profiles[0];
};

export const calculateTotalUsedGB = (profileOrConfig) => {
  if (!profileOrConfig) return 0;
  const profile = profileOrConfig.profiles ? getActiveProfile(profileOrConfig) : profileOrConfig;
  const baseline = Number(profile.initialBaselineGB) || 0;
  const sessionGB = (Number(profile.sessionBytes) || 0) / BYTES_PER_GB;
  return baseline + sessionGB;
};

export const getDailyHistoryGB = (config, profileId = config?.activeProfileId) => {
  const bytesHistory = config?.dailyHistoryByProfile?.[profileId] || {};
  return Object.fromEntries(Object.entries(bytesHistory).map(([dateKey, bytes]) => [dateKey, bytes / BYTES_PER_GB]));
};

export const addDailyUsageBytes = (config, profileId, dateKey, addedBytes) => {
  const safeAddedBytes = Math.max(0, Math.round(Number(addedBytes) || 0));
  if (!profileId || safeAddedBytes === 0) return config;
  const dailyHistoryByProfile = { ...(config.dailyHistoryByProfile || {}) };
  const profileHistory = { ...(dailyHistoryByProfile[profileId] || {}) };
  profileHistory[dateKey] = (Number(profileHistory[dateKey]) || 0) + safeAddedBytes;
  dailyHistoryByProfile[profileId] = profileHistory;
  return { ...config, dailyHistoryByProfile };
};

export const getTodayUsedGB = (config, profileId = config?.activeProfileId) => {
  const todayBytes = config?.dailyHistoryByProfile?.[profileId]?.[getTodayKey()] || 0;
  return todayBytes / BYTES_PER_GB;
};
