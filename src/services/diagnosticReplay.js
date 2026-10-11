import { parseDiagnosticReport } from './diagnosticService.js';
import { advanceNetworkObservation } from './networkObservation.js';
import { disconnectNetworkProfile, reconcileNetworkProfile, updateNetworkBinding } from './networkProfileService.js';

export function replayDiagnosticReport(input) {
  const report = parseDiagnosticReport(input);
  let config = structuredClone(report.initialConfig);
  let observation = null;
  let lastFingerprint = '';
  let disconnects = 0;
  let confirmed = 0;
  const trace = [];
  for (const event of report.events) {
    if (event.type === 'classification') {
      const profileId = config.profiles.some(p => p.id === event.profileId) ? event.profileId
        : config.networkBindings.find(b => b.fingerprint === event.targetFingerprint)?.profileId || '';
      config = updateNetworkBinding(config, { ...event, profileId });
      trace.push({ elapsedMs: event.elapsedMs, action: 'classification' });
    } else if (event.type === 'network-observation') {
      observation = advanceNetworkObservation(observation, event.identity);
      let action = 'waiting';
      if (!observation.fingerprint) {
        config = disconnectNetworkProfile(config); lastFingerprint = ''; disconnects++; action = 'disconnected';
      } else if (observation.confirmed && observation.fingerprint !== lastFingerprint) {
        confirmed++;
        const result = reconcileNetworkProfile(config, event.identity, new Date('2026-01-15T12:00:00Z'));
        config = result.config; action = result.action; lastFingerprint = observation.fingerprint;
      }
      trace.push({ elapsedMs: event.elapsedMs, action, activeFingerprint: config.activeNetworkFingerprint,
        profileCount: config.profiles.length });
    }
  }
  const created = trace.filter(t => t.action === 'created').length;
  const evidence = report.symptom === 'same-router-reconnect' ? disconnects > 0 && confirmed > 0 && report.initialConfig.networkBindings.length > 0
    : report.symptom === 'disconnect-prompt' ? disconnects > 0 : false;
  const failed = report.symptom === 'same-router-reconnect' ? created > 0
    : report.symptom === 'disconnect-prompt' ? trace.some(t => t.action === 'disconnected' && t.activeFingerprint) : false;
  return { status: !evidence || report.truncated ? 'needs-more-data' : failed ? 'reproduced' : 'not-reproduced',
    created, disconnects, confirmed, trace, finalConfig: config,
    limitation: '익명화된 네트워크 상태 전이를 재생합니다. 실제 USB 장치·시작 프로그램·ETW 동작은 별도 확인이 필요합니다.' };
}
