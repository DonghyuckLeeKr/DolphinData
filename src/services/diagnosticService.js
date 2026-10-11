// Explicit, bounded recording. Raw identifiers never enter a diagnostic report.
export const MAX_DIAGNOSTIC_EVENTS = 240;
export const MAX_DIAGNOSTIC_BYTES = 256 * 1024;
export const SYMPTOMS = Object.freeze({
  'same-router-reconnect': '같은 라우터 재연결 시 새 네트워크로 인식',
  'disconnect-prompt': 'USB 연결 해제 시 분류 창이 표시됨',
  usage: '사용량 기록 문제', startup: '시작 및 자동 실행 문제', other: '기타'
});
const kinds = ['usb-device', 'gateway-mac', 'network-name', 'adapter-gateway', 'adapter-mac', 'unknown', ''];
const modes = ['metered', 'unmetered', 'ignored', 'unclassified'];
const connections = ['ethernet', 'wifi', 'mobile', 'unknown', ''];
const genericName = /^(?:네트워크|network)(?:\s+\d+)?$/i;
const FIXED_DATE = '2026-01-15';
const versionText = v => typeof v === 'string' && /^\d{1,10}(?:\.\d{1,10}){1,4}$/.test(v) ? v : '';
const archs = ['x86_64', 'aarch64', 'x86', ''];

export function redactDescription(value) {
  return String(value || '').slice(0, 1000)
    .replace(/[A-Z]:\\Users\\[^\\\s]+/gi, '[사용자 경로]')
    .replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[이메일]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP]')
    .replace(/\b(?:[\da-f]{2}[:-]){5}[\da-f]{2}\b/gi, '[MAC]')
    .replace(/\b\d{14,22}\b/g, '[식별번호]');
}

export function createDiagnosticRecorder({ now = () => Date.now(), id = () => crypto.randomUUID() } = {}) {
  let report = null;
  let recording = false;
  let started = 0;
  let aliases = new Map();
  const alias = (type, raw) => {
    if (!raw) return '';
    const key = `${type}:${String(raw).trim().toLowerCase()}`;
    if (!aliases.has(key)) aliases.set(key, `${type}-${[...aliases.keys()].filter(k => k.startsWith(`${type}:`)).length + 1}`);
    return aliases.get(key);
  };
  const identity = raw => ({
    connected: Boolean(raw?.connected),
    fingerprint: raw?.connected ? alias('device', raw.fingerprint) : '',
    identityKind: kinds.includes(raw?.identityKind) ? raw.identityKind : 'unknown',
    networkName: genericName.test(raw?.networkName || '')
      ? `network ${alias('generic', raw.networkName).split('-')[1]}` : alias('name', raw?.networkName),
    interfaceName: alias('adapter', raw?.interfaceName),
    interfaceDescription: '',
    connectionType: connections.includes(raw?.connectionType?.toLowerCase()) ? raw.connectionType.toLowerCase() : 'unknown',
    gatewayIp: alias('gateway', raw?.gatewayIp)
  });
  function snapshot(config) {
    const profiles = (config.profiles || []).slice(0, 20).map(p => ({
      id: alias('profile', p.id), name: '요금제', carrierName: '', monthlyLimitGB: 100,
      initialBaselineGB: Number(p.initialBaselineGB) > 0 ? 1 : 0,
      sessionBytes: Number(p.sessionBytes) > 0 ? 1024 : 0, resetDay: 1,
      lastResetPeriod: '2026-01@day1', icon: '',
      profileOrigin: p.profileOrigin === 'auto-network' ? 'auto-network' : 'manual', needsRegistration: Boolean(p.needsRegistration)
    }));
    const networkBindings = (config.networkBindings || []).slice(0, 100).map(b => ({
      ...identity({ ...b, connected: true, connectionType: b.networkConnectionType }),
      profileId: alias('profile', b.profileId), meteringMode: modes.includes(b.meteringMode) ? b.meteringMode : 'unclassified'
    }));
    const dailyHistoryByProfile = {};
    for (const p of config.profiles || []) {
      if (Object.keys(config.dailyHistoryByProfile?.[p.id] || {}).length) dailyHistoryByProfile[alias('profile', p.id)] = { [FIXED_DATE]: 1024 };
    }
    return { profiles, networkBindings, dailyHistoryByProfile,
      activeProfileId: alias('profile', config.activeProfileId), activeNetworkFingerprint: alias('device', config.activeNetworkFingerprint) };
  }
  function add(event) {
    if (!recording) return;
    if (report.events.length >= MAX_DIAGNOSTIC_EVENTS) { recording = false; report.truncated = true; return; }
    report.events.push({ elapsedMs: Math.min(86400000, Math.max(0, now() - started)), ...event });
  }
  return {
    start(config, environment = {}) {
      aliases = new Map(); started = now(); recording = true;
      report = { schemaVersion: 1, reportId: id(), appVersion: /^\d+\.\d+\.\d+$/.test(environment.appVersion || '') ? environment.appVersion : '0.0.0',
        environment: { platform: environment.platform === 'windows' ? 'windows' : 'preview', admin: Boolean(environment.admin),
          osVersion: versionText(environment.osVersion), architecture: archs.includes(environment.architecture) ? environment.architecture : '',
          usbNetworkDrivers: (Array.isArray(environment.usbNetworkDrivers) ? environment.usbNetworkDrivers : []).slice(0, 8)
            .filter(d => /^[a-f0-9]{4}$/.test(d.vendorId) && /^[a-f0-9]{4}$/.test(d.productId) && versionText(d.version))
            .map(d => ({ vendorId: d.vendorId, productId: d.productId, version: d.version })) },
        symptom: 'other', description: '', truncated: false, initialConfig: snapshot(config), events: [] };
    },
    observe(raw) { if (recording) add({ type: 'network-observation', identity: identity(raw) }); },
    classify(raw, config) { if (!recording) return; add({ type: 'classification', fingerprint: alias('device', raw.fingerprint || config.activeNetworkFingerprint),
      profileId: alias('profile', raw.profileId), targetFingerprint: alias('device', config.networkBindings?.find(b => b.profileId === raw.profileId)?.fingerprint),
      meteringMode: modes.includes(raw.meteringMode) ? raw.meteringMode : 'unclassified' }); },
    error() { add({ type: 'detection-error' }); },
    stop() { recording = false; },
    status() { return { recording, eventCount: report?.events.length || 0, available: Boolean(report), truncated: Boolean(report?.truncated) }; },
    export({ symptom = 'other', description = '' } = {}) {
      if (!report) throw new Error('먼저 진단 기록을 시작해주세요.');
      return parseDiagnosticReport({ ...report, symptom, description: redactDescription(description) });
    }
  };
}

const fail = () => { throw new Error('지원하지 않거나 손상된 진단 리포트입니다.'); };
const obj = (v, keys) => {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail();
  return v;
};
const enumValue = (v, values) => values.includes(v) ? v : fail();
const bool = v => typeof v === 'boolean' ? v : fail();
const aliasValue = (v, type, empty = true) => typeof v === 'string' && ((empty && v === '') || new RegExp(`^${type}-[1-9]\\d{0,3}$`).test(v)) ? v : fail();
function readIdentity(v) {
  obj(v, ['connected', 'fingerprint', 'identityKind', 'networkName', 'interfaceName', 'interfaceDescription', 'connectionType', 'gatewayIp']);
  if (typeof v.networkName !== 'string' || !/^(?:|name-[1-9]\d{0,3}|network [1-9]\d{0,3})$/.test(v.networkName) || v.interfaceDescription !== '') fail();
  return { connected: bool(v.connected), fingerprint: aliasValue(v.fingerprint, 'device'), identityKind: enumValue(v.identityKind, kinds),
    networkName: v.networkName, interfaceName: aliasValue(v.interfaceName, 'adapter'), interfaceDescription: '',
    connectionType: enumValue(v.connectionType, connections), gatewayIp: aliasValue(v.gatewayIp, 'gateway') };
}
export function parseDiagnosticReport(input) {
  const encoded = typeof input === 'string' ? input.replace(/^\uFEFF/, '') : JSON.stringify(input);
  if (typeof encoded !== 'string' || new TextEncoder().encode(encoded).length > MAX_DIAGNOSTIC_BYTES) fail();
  const r = JSON.parse(encoded);
  obj(r, ['schemaVersion', 'reportId', 'appVersion', 'environment', 'symptom', 'description', 'truncated', 'initialConfig', 'events']);
  if (r.schemaVersion !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(r.reportId) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.appVersion)) fail();
  obj(r.environment, ['platform', 'admin', 'osVersion', 'architecture', 'usbNetworkDrivers']);
  enumValue(r.environment.platform, ['windows', 'preview']); bool(r.environment.admin);
  if (!Object.hasOwn(r.environment, 'osVersion')) r.environment.osVersion = '';
  if (!Object.hasOwn(r.environment, 'architecture')) r.environment.architecture = '';
  if (!Object.hasOwn(r.environment, 'usbNetworkDrivers')) r.environment.usbNetworkDrivers = [];
  if (r.environment.osVersion !== versionText(r.environment.osVersion)) fail();
  enumValue(r.environment.architecture, archs);
  if (!Array.isArray(r.environment.usbNetworkDrivers) || r.environment.usbNetworkDrivers.length > 8) fail();
  for (const d of r.environment.usbNetworkDrivers) {
    obj(d, ['vendorId', 'productId', 'version']);
    if (!/^[a-f0-9]{4}$/.test(d.vendorId) || !/^[a-f0-9]{4}$/.test(d.productId) || !versionText(d.version)) fail();
  }
  enumValue(r.symptom, Object.keys(SYMPTOMS)); bool(r.truncated);
  if (typeof r.description !== 'string' || r.description.length > 1000) fail();
  r.description = redactDescription(r.description);
  const c = obj(r.initialConfig, ['profiles', 'networkBindings', 'dailyHistoryByProfile', 'activeProfileId', 'activeNetworkFingerprint']);
  if (!Array.isArray(c.profiles) || !c.profiles.length || c.profiles.length > 20 || !Array.isArray(c.networkBindings) || c.networkBindings.length > 100) fail();
  for (const p of c.profiles) {
    obj(p, ['id', 'name', 'carrierName', 'monthlyLimitGB', 'initialBaselineGB', 'sessionBytes', 'resetDay', 'lastResetPeriod', 'icon', 'profileOrigin', 'needsRegistration']);
    aliasValue(p.id, 'profile', false); bool(p.needsRegistration); enumValue(p.profileOrigin, ['manual', 'auto-network']);
    if (p.name !== '요금제' || p.carrierName !== '' || p.monthlyLimitGB !== 100 || ![0, 1].includes(p.initialBaselineGB)
      || ![0, 1024].includes(p.sessionBytes) || p.resetDay !== 1 || p.lastResetPeriod !== '2026-01@day1' || p.icon !== '') fail();
  }
  const ids = new Set(c.profiles.map(p => p.id));
  if (ids.size !== c.profiles.length || !ids.has(c.activeProfileId)) fail();
  for (const b of c.networkBindings) {
    const { profileId, meteringMode, ...i } = b;
    readIdentity(i); aliasValue(profileId, 'profile'); enumValue(meteringMode, modes);
    if (profileId && !ids.has(profileId)) fail();
  }
  aliasValue(c.activeNetworkFingerprint, 'device');
  obj(c.dailyHistoryByProfile, [...ids]);
  for (const h of Object.values(c.dailyHistoryByProfile)) { obj(h, [FIXED_DATE]); if (h[FIXED_DATE] !== 1024) fail(); }
  if (!Array.isArray(r.events) || r.events.length > MAX_DIAGNOSTIC_EVENTS) fail();
  let previous = -1;
  for (const e of r.events) {
    if (!Number.isInteger(e.elapsedMs) || e.elapsedMs < 0 || e.elapsedMs < previous || e.elapsedMs > 86400000) fail();
    previous = e.elapsedMs;
    if (e.type === 'network-observation') { obj(e, ['elapsedMs', 'type', 'identity']); readIdentity(e.identity); }
    else if (e.type === 'classification') {
      obj(e, ['elapsedMs', 'type', 'fingerprint', 'profileId', 'targetFingerprint', 'meteringMode']);
      aliasValue(e.fingerprint, 'device', false); aliasValue(e.profileId, 'profile'); enumValue(e.meteringMode, modes);
      aliasValue(e.targetFingerprint, 'device');
    } else if (e.type === 'detection-error') obj(e, ['elapsedMs', 'type']);
    else fail();
  }
  return r;
}
// Free text remains private on the operator PC; it is never sent to AI/public CI.
export const publicDiagnosticContext = report => ({ ...parseDiagnosticReport(report), description: '' });
export const diagnosticRecorder = createDiagnosticRecorder();
