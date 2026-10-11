import { DEFAULT_PROFILE, MAX_PROFILES, getBillingPeriod } from './storageService.js';

const safeText = (value) => typeof value === 'string' ? value.trim() : '';

const sameAdapterAndGateway = (binding, identity) => {
  const interfaceName = safeText(identity.interfaceName).toLowerCase();
  const gatewayIp = safeText(identity.gatewayIp).toLowerCase();
  return Boolean(interfaceName && gatewayIp)
    && safeText(binding.interfaceName).toLowerCase() === interfaceName
    && safeText(binding.gatewayIp).toLowerCase() === gatewayIp;
};

const sameReconnectingNetwork = (binding, identity) => {
  if (!sameAdapterAndGateway(binding, identity)) return false;
  const previousName = safeText(binding.networkName).toLowerCase();
  const currentName = safeText(identity.networkName).toLowerCase();
  const genericName = /^(?:네트워크|network)(?:\s+\d+)?$/;
  return Boolean(previousName && currentName)
    && (previousName === currentName || (genericName.test(previousName) && genericName.test(currentName)));
};

const isStableIdentity = (kind) => kind === 'gateway-mac' || kind === 'usb-device';

const createProfileId = (fingerprint, profiles) => {
  const suffix = safeText(fingerprint).replace(/[^a-zA-Z0-9]/g, '').slice(-16) || Date.now().toString(36);
  const baseId = `network-${suffix}`;
  if (!profiles.some(profile => profile.id === baseId)) return baseId;

  let counter = 2;
  while (profiles.some(profile => profile.id === `${baseId}-${counter}`)) counter += 1;
  return `${baseId}-${counter}`;
};

const bindingFromIdentity = (identity, profileId, now) => ({
  fingerprint: safeText(identity.fingerprint),
  networkName: safeText(identity.networkName) || '알 수 없는 네트워크',
  identityKind: safeText(identity.identityKind),
  interfaceName: safeText(identity.interfaceName),
  interfaceDescription: safeText(identity.interfaceDescription),
  networkConnectionType: safeText(identity.connectionType),
  gatewayIp: safeText(identity.gatewayIp),
  profileId,
  meteringMode: 'unclassified',
  lastSeenAt: now.toISOString()
});

export const getActiveNetworkBinding = (config) => {
  if (!config?.activeNetworkFingerprint || !Array.isArray(config.networkBindings)) return null;
  return config.networkBindings.find(binding => binding.fingerprint === config.activeNetworkFingerprint) || null;
};

export const disconnectNetworkProfile = (config) => {
  if (!config?.activeNetworkFingerprint) return config;
  return { ...config, activeNetworkFingerprint: '' };
};

export const updateNetworkBinding = (config, bindingPartial = {}) => {
  const fingerprint = safeText(bindingPartial.fingerprint) || config?.activeNetworkFingerprint;
  const bindings = Array.isArray(config?.networkBindings) ? config.networkBindings : [];
  const bindingIndex = bindings.findIndex(binding => binding.fingerprint === fingerprint);
  if (bindingIndex < 0) return config;

  const requestedMode = ['metered', 'unmetered', 'ignored', 'unclassified'].includes(bindingPartial.meteringMode)
    ? bindingPartial.meteringMode
    : 'unclassified';
  const requestedProfileId = (config.profiles || []).some(profile => profile.id === bindingPartial.profileId)
    ? bindingPartial.profileId
    : '';
  if (requestedMode === 'metered' && !requestedProfileId) return config;

  const previousBinding = bindings[bindingIndex];
  const profileId = requestedMode === 'metered'
    ? requestedProfileId
    : requestedMode === 'unclassified'
      ? (requestedProfileId || previousBinding.profileId)
      : '';
  const networkBindings = bindings.map((binding, index) => index === bindingIndex
    ? { ...binding, meteringMode: requestedMode, profileId }
    : binding);

  let profiles = config.profiles || [];
  let activeProfileId = profileId || config.activeProfileId;
  let dailyHistoryByProfile = config.dailyHistoryByProfile || {};
  const candidate = profiles.find(profile => profile.id === previousBinding.profileId);
  const usedByAnotherNetwork = networkBindings.some(binding => binding.fingerprint !== fingerprint
    && binding.profileId === previousBinding.profileId);
  const isAutomaticPlaceholder = candidate?.profileOrigin === 'auto-network'
    && candidate.needsRegistration
    && !usedByAnotherNetwork;

  if (isAutomaticPlaceholder) {
    if (requestedMode === 'metered' && candidate.id === profileId) {
      profiles = profiles.map(profile => profile.id === candidate.id
        ? { ...profile, needsRegistration: false }
        : profile);
    } else if (candidate.id !== profileId || ['unmetered', 'ignored'].includes(requestedMode)) {
      const candidateHistory = dailyHistoryByProfile[candidate.id] || {};
      const hasRecordedUsage = (Number(candidate.initialBaselineGB) || 0) > 0
        || (Number(candidate.sessionBytes) || 0) > 0
        || Object.keys(candidateHistory).length > 0;
      const canMerge = requestedMode === 'metered' && profileId && (Number(candidate.initialBaselineGB) || 0) === 0;
      if (canMerge || !hasRecordedUsage) {
        profiles = profiles.filter(profile => profile.id !== candidate.id);
        if (canMerge) {
          profiles = profiles.map(profile => profile.id === profileId
            ? { ...profile, sessionBytes: Math.round((Number(profile.sessionBytes) || 0) + (Number(candidate.sessionBytes) || 0)) }
            : profile);
          if (Object.keys(candidateHistory).length > 0) {
            const targetHistory = { ...(dailyHistoryByProfile[profileId] || {}) };
            for (const [dateKey, bytes] of Object.entries(candidateHistory)) {
              targetHistory[dateKey] = (Number(targetHistory[dateKey]) || 0) + (Number(bytes) || 0);
            }
            dailyHistoryByProfile = { ...dailyHistoryByProfile, [profileId]: targetHistory };
          }
        }
        if (Object.hasOwn(dailyHistoryByProfile, candidate.id)) {
          dailyHistoryByProfile = { ...dailyHistoryByProfile };
          delete dailyHistoryByProfile[candidate.id];
        }
        if (activeProfileId === candidate.id) activeProfileId = profileId || profiles[0]?.id || '';
      }
    }
  }

  return {
    ...config,
    profiles,
    networkBindings,
    dailyHistoryByProfile,
    activeProfileId
  };
};

export const reconcileNetworkProfile = (config, identity, now = new Date()) => {
  const fingerprint = safeText(identity?.fingerprint);
  if (!identity?.connected || !fingerprint || !Array.isArray(config?.profiles)) {
    return { config, action: 'none', profileId: config?.activeProfileId || '', fingerprint: '' };
  }

  const profiles = config.profiles;
  const bindings = Array.isArray(config.networkBindings) ? config.networkBindings : [];
  let existingIndex = bindings.findIndex(binding => binding.fingerprint === fingerprint);

  // A reconnect can expose an adapter or gateway-MAC fingerprint before Windows
  // has resolved the USB device ID. Keep the known device binding while waiting.
  if (existingIndex < 0 && identity.identityKind !== 'usb-device'
    && bindings.some(binding => binding.identityKind === 'usb-device' && sameReconnectingNetwork(binding, identity))) {
    return { config, action: 'none', profileId: config.activeProfileId, fingerprint };
  }
  if (existingIndex < 0 && !isStableIdentity(identity.identityKind)
    && bindings.some(binding => binding.identityKind === 'gateway-mac' && sameReconnectingNetwork(binding, identity))) {
    return { config, action: 'none', profileId: config.activeProfileId, fingerprint };
  }

  // Upgrade one unambiguous older binding. A USB device identity can replace
  // rotating gateway-MAC identities, but two classified plans must stay separate.
  let ambiguousLegacyMatch = false;
  if (existingIndex < 0 && isStableIdentity(identity.identityKind)) {
    const candidates = bindings.map((binding, index) => ({ binding, index }))
      .filter(({ binding }) => sameReconnectingNetwork(binding, identity)
        && (identity.identityKind === 'usb-device'
          ? binding.identityKind !== 'usb-device'
          : !isStableIdentity(binding.identityKind)));
    const classified = candidates.filter(({ binding }) => binding.meteringMode !== 'unclassified');
    if (classified.length === 1) existingIndex = classified[0].index;
    else if (classified.length === 0 && candidates.length === 1) existingIndex = candidates[0].index;
    else ambiguousLegacyMatch = candidates.length > 0;
  }

  if (existingIndex >= 0) {
    const existing = bindings[existingIndex];
    const replacedFingerprint = existing.fingerprint !== fingerprint ? existing.fingerprint : '';
    const refreshed = {
      ...existing,
      fingerprint,
      networkName: safeText(identity.networkName) || existing.networkName,
      identityKind: safeText(identity.identityKind) || existing.identityKind,
      interfaceName: safeText(identity.interfaceName) || existing.interfaceName,
      interfaceDescription: safeText(identity.interfaceDescription) || existing.interfaceDescription,
      networkConnectionType: safeText(identity.connectionType) || existing.networkConnectionType,
      gatewayIp: safeText(identity.gatewayIp) || existing.gatewayIp,
      lastSeenAt: now.toISOString()
    };
    const profileId = profiles.some(profile => profile.id === refreshed.profileId)
      ? refreshed.profileId
      : config.activeProfileId;
    refreshed.profileId = profileId || '';
    const shouldSwitch = config.activeNetworkFingerprint !== fingerprint
      || (profileId && config.activeProfileId !== profileId);
    const metadataChanged = [
      'networkName',
      'identityKind',
      'interfaceName',
      'interfaceDescription',
      'networkConnectionType',
      'gatewayIp'
    ].some(key => refreshed[key] !== existing[key]);

    if (!shouldSwitch && !metadataChanged) {
      return { config, action: 'none', profileId, fingerprint };
    }

    const updatedBindings = bindings.map((binding, index) => index === existingIndex ? refreshed : binding);
    return {
      config: {
        ...config,
        networkBindings: updatedBindings,
        activeNetworkFingerprint: fingerprint,
        ...(profileId ? { activeProfileId: profileId } : {})
      },
      action: shouldSwitch ? 'switched' : 'updated',
      profileId,
      fingerprint,
      replacedFingerprint
    };
  }

  let profileId = config.activeProfileId;
  let updatedProfiles = profiles;
  if (ambiguousLegacyMatch && identity.identityKind === 'usb-device') {
    profileId = profiles.find(profile => !profile.needsRegistration)?.id || profileId;
  } else if (profiles.length < MAX_PROFILES) {
    profileId = createProfileId(fingerprint, profiles);
    const fallbackNumber = profiles.length + 1;
    const profileName = safeText(identity.networkName) || `새 네트워크 ${fallbackNumber}`;
    const newProfile = {
      ...DEFAULT_PROFILE,
      id: profileId,
      name: profileName,
      carrierName: '',
      lastResetPeriod: getBillingPeriod(1, now),
      icon: '📡',
      profileOrigin: 'auto-network',
      needsRegistration: true
    };
    updatedProfiles = [...profiles, newProfile];
  }

  const newBinding = bindingFromIdentity(identity, profileId, now);
  return {
    config: {
      ...config,
      profiles: updatedProfiles,
      networkBindings: [...bindings, newBinding],
      activeNetworkFingerprint: fingerprint,
      activeProfileId: profileId
    },
    action: 'created',
    profileId,
    fingerprint
  };
};
