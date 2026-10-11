import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnectNetworkProfile, getActiveNetworkBinding, reconcileNetworkProfile, updateNetworkBinding } from '../src/services/networkProfileService.js';
import { normalizeConfig } from '../src/services/storageService.js';

const makeConfig = () => normalizeConfig({
  activeProfileId: 'profile-1',
  profiles: [{
    id: 'profile-1',
    name: '기존 수동 프로필',
    resetDay: 1,
    lastResetPeriod: '2026-08@day1'
  }]
});

const identity = (fingerprint, networkName = 'Phone Hotspot B') => ({
  connected: true,
  fingerprint,
  identityKind: 'gateway-mac',
  networkName,
  interfaceName: 'Wi-Fi',
  interfaceDescription: 'Wireless Adapter',
  connectionType: 'Native 802.11',
  gatewayIp: '192.168.219.1'
});

test('a first-seen network creates and activates a tagged profile', () => {
  const result = reconcileNetworkProfile(makeConfig(), identity('network-v1-b'));
  const created = result.config.profiles.at(-1);
  const binding = getActiveNetworkBinding(result.config);

  assert.equal(result.action, 'created');
  assert.equal(result.config.activeProfileId, created.id);
  assert.equal(binding.fingerprint, 'network-v1-b');
  assert.equal(binding.interfaceName, 'Wi-Fi');
  assert.equal(binding.networkConnectionType, 'Native 802.11');
  assert.equal(binding.gatewayIp, '192.168.219.1');
  assert.equal(binding.meteringMode, 'unclassified');
  assert.equal(binding.profileId, created.id);
  assert.equal(created.needsRegistration, true);
  assert.equal(created.networkFingerprint, undefined);
});

test('a known network refreshes its persisted adapter connection type', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-b'));
  const staleBindings = first.config.networkBindings.map(binding => ({ ...binding, networkConnectionType: '' }));
  const second = reconcileNetworkProfile({ ...first.config, networkBindings: staleBindings }, identity('network-v1-b'));

  assert.equal(second.action, 'updated');
  assert.equal(getActiveNetworkBinding(second.config).networkConnectionType, 'Native 802.11');
});

test('a known network switches to its existing profile without duplication', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-b'));
  const withOtherActive = { ...first.config, activeProfileId: 'profile-1' };
  const second = reconcileNetworkProfile(withOtherActive, identity('network-v1-b'));

  assert.equal(second.action, 'switched');
  assert.equal(second.config.profiles.length, 2);
  assert.equal(second.config.activeProfileId, first.profileId);
});

test('the same known network remains unchanged and does not trigger new-network setup again', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-b'));
  const second = reconcileNetworkProfile(first.config, identity('network-v1-b'));

  assert.equal(second.action, 'none');
  assert.equal(second.config, first.config);
});

test('disconnect clears the active network without removing its plan or usage', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-b'));
  const disconnected = disconnectNetworkProfile(first.config);

  assert.equal(disconnected.activeNetworkFingerprint, '');
  assert.equal(getActiveNetworkBinding(disconnected), null);
  assert.deepEqual(disconnected.networkBindings, first.config.networkBindings);
  assert.deepEqual(disconnected.profiles, first.config.profiles);
  assert.equal(disconnectNetworkProfile(disconnected), disconnected);
});

test('a temporary adapter fingerprint upgrades to the router fingerprint without another profile', () => {
  const temporary = reconcileNetworkProfile(makeConfig(), {
    ...identity('network-v1-adapter', '네트워크 74'),
    identityKind: 'adapter-gateway'
  });
  const resolved = reconcileNetworkProfile(temporary.config, identity('network-v1-router', '네트워크 75'));

  assert.equal(resolved.action, 'switched');
  assert.equal(resolved.config.profiles.length, 2);
  assert.equal(resolved.config.networkBindings.length, 1);
  assert.equal(resolved.config.networkBindings[0].fingerprint, 'network-v1-router');
  assert.equal(resolved.profileId, temporary.profileId);
  assert.equal(resolved.replacedFingerprint, temporary.fingerprint);
});

test('a reconnect upgrades one older classified router binding and keeps its usage plan', () => {
  const oldConfig = normalizeConfig({
    activeProfileId: 'profile-1',
    profiles: [{ id: 'profile-1', name: '모바일 데이터 요금제', sessionBytes: 12345 }],
    activeNetworkFingerprint: 'network-v1-old-name',
    networkBindings: [{
      fingerprint: 'network-v1-old-name',
      identityKind: 'network-name',
      networkName: '네트워크 74',
      interfaceName: 'Wi-Fi',
      gatewayIp: '192.168.219.1',
      profileId: 'profile-1',
      meteringMode: 'metered'
    }]
  });
  const reconnected = reconcileNetworkProfile(oldConfig, identity('network-v1-router', '네트워크 75'));

  assert.equal(reconnected.action, 'switched');
  assert.equal(reconnected.config.profiles.length, 1);
  assert.equal(reconnected.config.profiles[0].sessionBytes, 12345);
  assert.equal(reconnected.config.networkBindings.length, 1);
  assert.equal(reconnected.config.networkBindings[0].fingerprint, 'network-v1-router');
  assert.equal(reconnected.config.networkBindings[0].meteringMode, 'metered');
});

test('a weak reconnect snapshot waits when a strong router binding already exists', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-router', '네트워크 74'));
  const temporary = reconcileNetworkProfile(first.config, {
    ...identity('network-v1-adapter', '네트워크 75'),
    identityKind: 'adapter-gateway'
  });

  assert.equal(temporary.action, 'none');
  assert.equal(temporary.config, first.config);
});

test('a different router MAC on the same adapter remains a new network', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-router-a', '네트워크 74'));
  const second = reconcileNetworkProfile(first.config, identity('network-v1-router-b', '네트워크 75'));

  assert.equal(second.action, 'created');
  assert.equal(second.config.profiles.length, 3);
  assert.equal(second.config.networkBindings.length, 2);
});

test('different named hotspots with the same gateway are not merged', () => {
  const oldConfig = normalizeConfig({
    activeProfileId: 'profile-1',
    profiles: [{ id: 'profile-1', name: 'First plan' }],
    activeNetworkFingerprint: 'network-v1-old-name',
    networkBindings: [{
      fingerprint: 'network-v1-old-name',
      identityKind: 'network-name',
      networkName: 'Phone A',
      interfaceName: 'Wi-Fi',
      gatewayIp: '192.168.219.1',
      profileId: 'profile-1',
      meteringMode: 'metered'
    }]
  });
  const second = reconcileNetworkProfile(oldConfig, identity('network-v1-phone-b', 'Phone B'));

  assert.equal(second.action, 'created');
  assert.equal(second.config.profiles.length, 2);
});

test('rotating USB router gateway MACs upgrade to a stable device binding', () => {
  const oldConfig = normalizeConfig({
    activeProfileId: 'profile-1',
    profiles: [{ id: 'profile-1', name: '모바일 데이터 요금제', sessionBytes: 12345 }],
    activeNetworkFingerprint: 'network-v1-old-gateway-mac',
    networkBindings: [{
      fingerprint: 'network-v1-old-gateway-mac',
      identityKind: 'gateway-mac',
      networkName: '네트워크 75',
      interfaceName: '이더넷',
      gatewayIp: '192.168.0.1',
      profileId: 'profile-1',
      meteringMode: 'metered'
    }]
  });
  const usbIdentity = {
    ...identity('network-v1-usb-device', '네트워크 76'),
    identityKind: 'usb-device',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  };
  const upgraded = reconcileNetworkProfile(oldConfig, usbIdentity);
  const rebooted = reconcileNetworkProfile(upgraded.config, { ...usbIdentity, networkName: '네트워크 77' });

  assert.equal(upgraded.action, 'switched');
  assert.equal(upgraded.config.profiles.length, 1);
  assert.equal(upgraded.config.networkBindings.length, 1);
  assert.equal(upgraded.config.networkBindings[0].fingerprint, 'network-v1-usb-device');
  assert.equal(upgraded.config.profiles[0].sessionBytes, 12345);
  assert.equal(rebooted.action, 'updated');
  assert.equal(rebooted.config.profiles.length, 1);
  assert.equal(rebooted.config.networkBindings.length, 1);
});

test('a temporary gateway MAC does not replace an established USB device binding', () => {
  const first = reconcileNetworkProfile(makeConfig(), {
    ...identity('network-v1-usb-device', '네트워크 75'),
    identityKind: 'usb-device',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  });
  const temporary = reconcileNetworkProfile(first.config, {
    ...identity('network-v1-new-gateway-mac', '네트워크 76'),
    identityKind: 'gateway-mac',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  });

  assert.equal(temporary.action, 'none');
  assert.equal(temporary.config, first.config);
});

test('ambiguous old USB bindings request classification without adding another profile', () => {
  const oldConfig = normalizeConfig({
    activeProfileId: 'network-74',
    profiles: [
      { id: 'profile-1', name: '메인 요금제', profileOrigin: 'manual' },
      { id: 'network-74', name: '네트워크 74', profileOrigin: 'auto-network', needsRegistration: true }
    ],
    networkBindings: [
      { fingerprint: 'old-a', identityKind: 'gateway-mac', networkName: '네트워크 73', interfaceName: '이더넷', gatewayIp: '192.168.0.1', profileId: 'profile-1', meteringMode: 'metered' },
      { fingerprint: 'old-b', identityKind: 'gateway-mac', networkName: '네트워크 74', interfaceName: '이더넷', gatewayIp: '192.168.0.1', profileId: 'network-74', meteringMode: 'metered' }
    ]
  });
  const reviewed = reconcileNetworkProfile(oldConfig, {
    ...identity('network-v1-usb-device', '네트워크 76'),
    identityKind: 'usb-device',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  });

  assert.equal(reviewed.action, 'created');
  assert.equal(reviewed.config.profiles.length, 2);
  assert.equal(reviewed.config.networkBindings.length, 3);
  assert.equal(reviewed.config.networkBindings.at(-1).profileId, 'profile-1');
  assert.equal(reviewed.config.networkBindings.at(-1).meteringMode, 'unclassified');
});

test('different USB device identities stay separate on the same adapter and gateway address', () => {
  const first = reconcileNetworkProfile(makeConfig(), {
    ...identity('usb-device-a', '네트워크 75'),
    identityKind: 'usb-device',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  });
  const second = reconcileNetworkProfile(first.config, {
    ...identity('usb-device-b', '네트워크 76'),
    identityKind: 'usb-device',
    interfaceName: '이더넷',
    gatewayIp: '192.168.0.1'
  });

  assert.equal(second.action, 'created');
  assert.equal(second.config.profiles.length, 3);
});

test('classifying a new network as unmetered removes only its untouched automatic placeholder', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-home', 'Home Wi-Fi'));
  const updated = updateNetworkBinding(first.config, {
    fingerprint: first.fingerprint,
    meteringMode: 'unmetered',
    profileId: ''
  });
  const binding = getActiveNetworkBinding(updated);

  assert.equal(binding.meteringMode, 'unmetered');
  assert.equal(binding.profileId, '');
  assert.equal(updated.profiles.length, 1);
  assert.equal(updated.profiles[0].id, 'profile-1');
});

test('different hotspots receive isolated profiles', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-b', 'Hotspot B'));
  const second = reconcileNetworkProfile(first.config, identity('network-v1-c', 'Hotspot C'));

  assert.equal(second.config.profiles.length, 3);
  assert.equal(second.config.networkBindings.length, 2);
  assert.notEqual(first.profileId, second.profileId);
  assert.equal(getActiveNetworkBinding(second.config).networkName, 'Hotspot C');
});

test('a disconnected snapshot never creates or switches a profile', () => {
  const config = makeConfig();
  const result = reconcileNetworkProfile(config, { connected: false, fingerprint: '' });

  assert.equal(result.action, 'none');
  assert.equal(result.config, config);
});

test('classifying a new network as metered with main profile prunes placeholder and transfers bytes', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-dongle', '네트워크 74'));
  const placeholderId = first.profileId;
  first.config.profiles = first.config.profiles.map(p => p.id === placeholderId
    ? { ...p, sessionBytes: 100 * 1024 * 1024 }
    : p);
  first.config.dailyHistoryByProfile = {
    'profile-1': { '2026-09-28': 20 * 1024 * 1024 },
    [placeholderId]: { '2026-09-28': 100 * 1024 * 1024 }
  };

  const updated = updateNetworkBinding(first.config, {
    fingerprint: first.fingerprint,
    meteringMode: 'metered',
    profileId: 'profile-1'
  });

  assert.equal(updated.profiles.length, 1);
  assert.equal(updated.profiles[0].id, 'profile-1');
  assert.equal(updated.profiles[0].sessionBytes, 100 * 1024 * 1024);
  assert.equal(getActiveNetworkBinding(updated).profileId, 'profile-1');
  assert.equal(updated.dailyHistoryByProfile['profile-1']['2026-09-28'], 120 * 1024 * 1024);
  assert.equal(updated.dailyHistoryByProfile[placeholderId], undefined);
});

test('classifying a network as unmetered never charges its previous usage to another plan', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-home', 'Home Wi-Fi'));
  const placeholderId = first.profileId;
  const withUsage = {
    ...first.config,
    profiles: first.config.profiles.map(profile => profile.id === placeholderId
      ? { ...profile, sessionBytes: 100 * 1024 * 1024 }
      : profile),
    dailyHistoryByProfile: { [placeholderId]: { '2026-09-28': 100 * 1024 * 1024 } }
  };
  const updated = updateNetworkBinding(withUsage, {
    fingerprint: first.fingerprint,
    meteringMode: 'unmetered',
    profileId: ''
  });

  assert.equal(getActiveNetworkBinding(updated).meteringMode, 'unmetered');
  assert.equal(updated.profiles.find(profile => profile.id === 'profile-1').sessionBytes, 0);
  assert.equal(updated.profiles.find(profile => profile.id === placeholderId).sessionBytes, 100 * 1024 * 1024);
  assert.equal(updated.dailyHistoryByProfile[placeholderId]['2026-09-28'], 100 * 1024 * 1024);
});

test('a placeholder with its own baseline remains available when another plan is selected', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-dongle', '네트워크 74'));
  const withBaseline = {
    ...first.config,
    profiles: first.config.profiles.map(profile => profile.id === first.profileId
      ? { ...profile, initialBaselineGB: 4 }
      : profile)
  };
  const updated = updateNetworkBinding(withBaseline, {
    fingerprint: first.fingerprint,
    meteringMode: 'metered',
    profileId: 'profile-1'
  });

  assert.equal(updated.profiles.length, 2);
  assert.equal(updated.profiles.find(profile => profile.id === first.profileId).initialBaselineGB, 4);
  assert.equal(updated.profiles.find(profile => profile.id === 'profile-1').initialBaselineGB, 0);
});

test('classifying a new network as metered with its placeholder confirms the profile', () => {
  const first = reconcileNetworkProfile(makeConfig(), identity('network-v1-dongle', '새 네트워크'));
  const placeholderId = first.profileId;

  const updated = updateNetworkBinding(first.config, {
    fingerprint: first.fingerprint,
    meteringMode: 'metered',
    profileId: placeholderId
  });

  assert.equal(updated.profiles.length, 2);
  const confirmed = updated.profiles.find(p => p.id === placeholderId);
  assert.equal(confirmed.needsRegistration, false);
});
