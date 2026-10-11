import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDailyUsageBytes,
  getBillingPeriod,
  MAX_DAILY_HISTORY_ENTRIES,
  normalizeConfig,
  rolloverBillingCycles
} from '../src/services/storageService.js';

const makeConfig = (overrides = {}) => normalizeConfig({
  activeProfileId: 'profile-1',
  profiles: [{
    id: 'profile-1',
    name: '테스트 요금제',
    resetDay: 1,
    lastResetPeriod: '2026-07@day1',
    initialBaselineGB: 12,
    sessionBytes: 3456
  }],
  ...overrides
});

test('billing period uses the last calendar day when resetDay does not exist', () => {
  assert.equal(getBillingPeriod(31, new Date(2026, 1, 27)), '2026-01@day31');
  assert.equal(getBillingPeriod(31, new Date(2026, 1, 28)), '2026-02@day31');
});

test('runtime rollover resets baseline and session bytes once the period changes', () => {
  const config = makeConfig();
  const rolled = rolloverBillingCycles(config, new Date(2026, 7, 1));
  assert.equal(rolled.profiles[0].initialBaselineGB, 0);
  assert.equal(rolled.profiles[0].sessionBytes, 0);
  assert.equal(rolled.profiles[0].lastResetPeriod, '2026-08@day1');
});

test('daily usage keeps exact bytes and remains isolated by profile', () => {
  const config = makeConfig({
    profiles: [
      { id: 'profile-1', name: 'A', resetDay: 1, lastResetPeriod: '2026-08@day1' },
      { id: 'profile-2', name: 'B', resetDay: 1, lastResetPeriod: '2026-08@day1' }
    ]
  });
  const first = addDailyUsageBytes(config, 'profile-1', '2026-08-19', 25_000);
  const second = addDailyUsageBytes(first, 'profile-1', '2026-08-19', 25_000);
  const third = addDailyUsageBytes(second, 'profile-2', '2026-08-19', 100_000);

  assert.equal(third.dailyHistoryByProfile['profile-1']['2026-08-19'], 50_000);
  assert.equal(third.dailyHistoryByProfile['profile-2']['2026-08-19'], 100_000);
});

test('legacy global GB history migrates to active-profile byte history', () => {
  const config = normalizeConfig({
    carrierName: 'Legacy',
    monthlyLimitGB: 50,
    dailyHistory: { '2026-08-18': 1.5 }
  });
  assert.equal(config.dailyHistoryByProfile['profile-1']['2026-08-18'], 1.5 * 1024 * 1024 * 1024);
});

test('malformed backup without a profile is rejected', () => {
  assert.throws(() => normalizeConfig({ profiles: 'not-an-array' }), /유효한 요금제 프로필/);
});

test('legacy profile network metadata migrates to a separate metered binding', () => {
  const config = normalizeConfig({
    activeProfileId: 'auto-b',
    profiles: [{
      id: 'auto-b',
      name: 'Hotspot B',
      networkFingerprint: 'network-v1-b',
      networkName: 'Hotspot B',
      networkIdentityKind: 'gateway-mac',
      selectedInterface: 'Wi-Fi',
      interfaceDescription: 'Intel Wi-Fi',
      networkConnectionType: 'Native 802.11',
      profileOrigin: 'auto-network',
      needsRegistration: true
    }]
  });

  assert.equal(config.profiles[0].networkFingerprint, undefined);
  assert.equal(config.profiles[0].profileOrigin, 'auto-network');
  assert.equal(config.profiles[0].needsRegistration, true);
  assert.deepEqual(config.networkBindings[0], {
    fingerprint: 'network-v1-b',
    networkName: 'Hotspot B',
    identityKind: 'gateway-mac',
    interfaceName: 'Wi-Fi',
    interfaceDescription: 'Intel Wi-Fi',
    networkConnectionType: 'Native 802.11',
    gatewayIp: '',
    profileId: 'auto-b',
    meteringMode: 'metered',
    lastSeenAt: ''
  });
});

test('network binding normalization strips unknown fields and rejects an unbound metered mode', () => {
  const config = makeConfig({
    activeNetworkFingerprint: 'network-v1-a',
    networkBindings: [{
      fingerprint: 'network-v1-a',
      networkName: 'Home Wi-Fi',
      profileId: 'missing-profile',
      meteringMode: 'metered',
      injectedField: 'drop-me'
    }]
  });

  assert.equal(config.activeNetworkFingerprint, 'network-v1-a');
  assert.equal(config.networkBindings[0].profileId, '');
  assert.equal(config.networkBindings[0].meteringMode, 'unclassified');
  assert.equal(config.networkBindings[0].injectedField, undefined);
});

test('backup normalization keeps only the supported config and profile schema', () => {
  const config = normalizeConfig({
    activeProfileId: 'profile-1',
    profiles: [{
      id: 'profile-1',
      name: '안전한 프로필',
      affiliateUrl: 'javascript:alert(1)',
      injectedProfileField: { unexpected: true }
    }],
    alerts: { t80: false, injectedAlert: true },
    injectedTopLevelField: 'drop-me'
  });

  assert.equal(config.profiles[0].name, '안전한 프로필');
  assert.equal(config.profiles[0].affiliateUrl, undefined);
  assert.equal(config.profiles[0].injectedProfileField, undefined);
  assert.equal(config.injectedTopLevelField, undefined);
  assert.deepEqual(config.alerts, { t80: false, t90: true, t95: true, dailySurge: true });
});

test('daily history is limited to known profiles and the newest bounded entries', () => {
  const history = {};
  for (let index = 0; index < MAX_DAILY_HISTORY_ENTRIES + 5; index += 1) {
    const date = new Date(Date.UTC(2026, 0, 1 + index));
    history[date.toISOString().slice(0, 10)] = index;
  }

  const config = makeConfig({
    dailyHistoryByProfile: {
      'profile-1': history,
      unknown: { '2026-08-19': 999 }
    }
  });

  assert.equal(Object.keys(config.dailyHistoryByProfile['profile-1']).length, MAX_DAILY_HISTORY_ENTRIES);
  assert.equal(config.dailyHistoryByProfile.unknown, undefined);
});

test('only empty unbound generic placeholders are removed on load', () => {
  const config = normalizeConfig({
    activeProfileId: 'profile-dummy-74',
    profiles: [
      {
        id: 'profile-1',
        name: '모바일 데이터 요금제',
        profileOrigin: 'manual',
        needsRegistration: false,
        sessionBytes: 500000000
      },
      {
        id: 'profile-dummy-identifying',
        name: '식별 중... (정보 등록 필요)',
        profileOrigin: 'auto-network',
        needsRegistration: true,
        sessionBytes: 0
      },
      {
        id: 'profile-dummy-74',
        name: '네트워크 74 (정보 등록 필요)',
        profileOrigin: 'auto-network',
        needsRegistration: true,
        sessionBytes: 1600000000,
        initialBaselineGB: 4
      },
      {
        id: 'profile-dummy-75',
        name: '네트워크 75 (정보 등록 필요)',
        profileOrigin: 'auto-network',
        needsRegistration: true,
        sessionBytes: 0
      }
    ],
    networkBindings: [
      {
        fingerprint: 'network-v1-74',
        networkName: '네트워크 74',
        profileId: 'profile-dummy-74',
        meteringMode: 'metered'
      }
    ],
    dailyHistoryByProfile: {
      'profile-dummy-74': { '2026-09-28': 1600000000 }
    }
  });

  assert.equal(config.profiles.length, 2);
  assert.equal(config.profiles[0].id, 'profile-1');
  assert.equal(config.profiles[0].sessionBytes, 500000000);
  assert.equal(config.profiles[1].id, 'profile-dummy-74');
  assert.equal(config.profiles[1].sessionBytes, 1600000000);
  assert.equal(config.profiles[1].initialBaselineGB, 4);
  assert.equal(config.activeProfileId, 'profile-dummy-74');
  assert.equal(config.networkBindings[0].profileId, 'profile-dummy-74');
  assert.equal(config.dailyHistoryByProfile['profile-dummy-74']['2026-09-28'], 1600000000);
});

test('unbound placeholder with recorded usage is retained without moving it to another plan', () => {
  const config = normalizeConfig({
    activeProfileId: 'profile-1',
    profiles: [
      { id: 'profile-1', name: 'Main', sessionBytes: 50 },
      { id: 'network-unused', name: '네트워크 75', profileOrigin: 'auto-network', needsRegistration: true, sessionBytes: 200 }
    ],
    networkBindings: []
  });

  assert.equal(config.profiles.length, 2);
  assert.equal(config.profiles[0].sessionBytes, 50);
  assert.equal(config.profiles[1].sessionBytes, 200);
});
