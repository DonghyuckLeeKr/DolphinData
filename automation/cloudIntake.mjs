// Pulls reports that the app submitted to the always-on Cloudflare intake while this PC
// was off, imports them like any other public report (they wait for owner triage), and
// deletes them from the cloud queue once they are safely stored here.

export const CLOUD_PULL_INTERVAL_MS = 60 * 1000;

export function cloudIntakeEndpoint(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || !['/', ''].includes(url.pathname)) {
    throw new Error('클라우드 접수 주소를 확인해주세요.');
  }
  return url.origin;
}

// A corrupt report, or one that conflicts with an already stored copy, will never import,
// so it is dropped instead of retried forever. Anything else (storage cap, disk errors)
// leaves the report in the cloud queue for the next pull.
const isPermanentRejection = error => /지원하지 않거나 손상된|이미 접수한 기록/.test(String(error?.message || ''));

export function startCloudIntake(controller, { endpoint, token, fetchImpl = fetch, intervalMs = CLOUD_PULL_INTERVAL_MS, log = console } = {}) {
  const origin = cloudIntakeEndpoint(endpoint);
  const status = { connected: false, error: '', lastPullAt: '', pending: 0, imported: 0 };
  const headers = { Authorization: `Bearer ${token}` };
  let inFlight = null;
  let timer = null;

  const request = (path, options = {}) => fetchImpl(`${origin}${path}`, {
    ...options, headers, redirect: 'error', signal: AbortSignal.timeout(15000)
  });

  // Overlapping triggers share one pull, so a report is never imported twice concurrently.
  const pull = () => {
    inFlight ||= pullOnce().finally(() => { inFlight = null; });
    return inFlight;
  };

  const pullOnce = async () => {
    try {
      for (let round = 0; round < 8; round++) {
        const response = await request('/v1/admin/reports?limit=25');
        if (!response.ok) throw new Error(response.status === 401 ? '클라우드 접수 관리자 토큰을 확인해주세요.' : `클라우드 접수 응답 ${response.status}`);
        const { reports, pending } = await response.json();
        status.pending = Math.max(0, pending - reports.length);
        if (!reports.length) break;
        for (const item of reports) {
          try {
            await controller.importReport(item.body);
            status.imported++;
          } catch (error) {
            if (!isPermanentRejection(error)) throw error;
            log.warn?.(`클라우드 접수 ${item.receiptId}를 가져오지 못해 대기열에서 제외합니다.`);
          }
          const removed = await request(`/v1/admin/reports/${item.receiptId}`, { method: 'DELETE' });
          if (!removed.ok && removed.status !== 404) throw new Error(`클라우드 접수 삭제 응답 ${removed.status}`);
        }
        if (reports.length < 25) break;
      }
      status.connected = true;
      status.error = '';
      status.lastPullAt = new Date().toISOString();
    } catch (error) {
      status.connected = false;
      status.error = String(error?.message || error).slice(0, 200);
    }
  };

  void pull();
  timer = setInterval(pull, intervalMs);
  return { status, pull, close() { clearInterval(timer); } };
}
