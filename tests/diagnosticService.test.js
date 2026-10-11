import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnosticRecorder, parseDiagnosticReport, publicDiagnosticContext, MAX_DIAGNOSTIC_EVENTS } from '../src/services/diagnosticService.js';
import { replayDiagnosticReport } from '../src/services/diagnosticReplay.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

export const rawIdentity = { connected: true, fingerprint: 'private-usb-device-123', identityKind: 'usb-device', networkName: '네트워크 76', interfaceName: '이더넷 3',
  interfaceDescription: 'Private Router Serial', connectionType: 'ethernet', gatewayIp: '192.168.0.1' };
export function sampleReport() {
  let clock = 0;
  const recorder = createDiagnosticRecorder({ now: () => clock, id: () => '12345678-1234-1234-1234-123456789abc' });
  const config = { profiles: [{ ...DEFAULT_PROFILE, id: 'private-plan', name: 'My Carrier', initialBaselineGB: 19.7, sessionBytes: 99999999 }], activeProfileId: 'private-plan', activeNetworkFingerprint: rawIdentity.fingerprint,
    networkBindings: [{ ...rawIdentity, networkConnectionType: 'ethernet', profileId: 'private-plan', meteringMode: 'metered' }], dailyHistoryByProfile: { 'private-plan': { '2026-10-11': 99999 } } };
  recorder.start(config, { appVersion: '1.2.11', platform: 'windows', admin: false });
  const observe = identity => { clock += 5000; recorder.observe(identity); };
  observe({ connected: false }); observe(rawIdentity); observe(rawIdentity);
  recorder.stop(); return recorder.export({ symptom: 'same-router-reconnect', description: 'My private words email@example.com 192.168.0.1 C:\\Users\\PrivateUser\\file 123456789012345' });
}
test('diagnostic export anonymizes identifiers, counters and free text', () => {
  const report = sampleReport(); const text = JSON.stringify(report);
  for (const raw of ['private-usb-device-123', '192.168.0.1', 'PrivateUser', 'Private Router Serial', '이더넷 3', 'My Carrier', '99999999', '123456789012345', 'email@example.com']) assert.ok(!text.includes(raw), raw);
  assert.equal(report.initialConfig.profiles[0].initialBaselineGB, 1);
  assert.equal(report.initialConfig.networkBindings[0].fingerprint, report.events[1].identity.fingerprint);
  assert.equal(publicDiagnosticContext(report).description, '');
  assert.ok(report.description.includes('My private words'));
});
test('diagnostic import accepts a Windows UTF-8 BOM', () => {
  assert.equal(parseDiagnosticReport('\uFEFF' + JSON.stringify(sampleReport())).reportId, sampleReport().reportId);
});
test('environment export keeps only common hardware model and version fields', () => {
  const recorder = createDiagnosticRecorder();
  recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id }, { osVersion: '10.0.26300', architecture: 'x86_64',
    usbNetworkDrivers: [{ vendorId: '19d2', productId: '1557', version: '10.0.26100.1', deviceId: 'PRIVATE SERIAL', sim: 'PRIVATE SIM' }] });
  const report = recorder.export(); assert.equal(report.environment.usbNetworkDrivers.length, 1);
  assert.ok(!JSON.stringify(report).includes('PRIVATE'));
  report.environment.usbNetworkDrivers[0].deviceId = 'unknown'; assert.throws(() => parseDiagnosticReport(report));
});
test('recording is opt-in, bounded, and a stopped recording is immutable', () => {
  const recorder = createDiagnosticRecorder({ id: () => '12345678-1234-1234-1234-123456789abc' });
  recorder.observe(rawIdentity); assert.equal(recorder.status().available, false);
  recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id });
  for (let i = 0; i < MAX_DIAGNOSTIC_EVENTS + 20; i++) recorder.observe(rawIdentity);
  assert.equal(recorder.status().eventCount, MAX_DIAGNOSTIC_EVENTS); assert.equal(recorder.status().recording, false); assert.equal(recorder.status().truncated, true);
});
test('import rejects unsupported fields, prototype keys, oversized files and identifiers', () => {
  for (const mutate of [r => { r.rawMac = '00:11:22:33:44:55'; }, r => { r.events[1].identity.gatewayIp = '192.168.0.1'; },
    r => { r.initialConfig.profiles[0].sessionBytes = 12345; }, r => { r.events[0].elapsedMs = -1; }, r => { r.events[2].elapsedMs = 0; },
    r => { r.description = 'x'.repeat(300000); }, r => { r.initialConfig.dailyHistoryByProfile = JSON.parse('{"__proto__":{}}'); }]) {
    const report = sampleReport(); mutate(report); assert.throws(() => parseDiagnosticReport(report));
  }
});
test('replay disconnect/reconnect preserves classified plan, baseline, usage and history', () => {
  const report = sampleReport(); const result = replayDiagnosticReport(report);
  assert.equal(result.status, 'not-reproduced'); assert.equal(result.created, 0);
  assert.equal(result.trace[0].activeFingerprint, '');
  assert.deepEqual(result.finalConfig.profiles, report.initialConfig.profiles);
  assert.deepEqual(result.finalConfig.dailyHistoryByProfile, report.initialConfig.dailyHistoryByProfile);
  assert.equal(result.finalConfig.networkBindings[0].meteringMode, 'metered');
});
test('report with a changed USB identity reproduces creation without asserting same physical router', () => {
  const report = sampleReport(); report.events[1].identity.fingerprint = 'device-2'; report.events[2].identity.fingerprint = 'device-2';
  assert.equal(replayDiagnosticReport(report).status, 'reproduced');
  report.truncated = true; assert.equal(replayDiagnosticReport(report).status, 'needs-more-data');
});
