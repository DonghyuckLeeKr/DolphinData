// Always-on diagnostic intake. The Windows app posts reports here; the operator's PC
// pulls them through the admin API when its automation is running, then deletes them.
// Storage is behind a small interface so the same handler runs on D1 and in Node tests.
import { MAX_DIAGNOSTIC_BYTES, parseDiagnosticReport } from '../../../src/services/diagnosticService.js';

export const SERVICE_STATUS = { service: 'DolphinData diagnostic intake', schemaVersion: 1 };
export const RATE_LIMIT = { windowMs: 10 * 60 * 1000, perClient: 6 };
// Reports wait here only until the PC pulls them; past this the queue is treated as stuck or abused.
export const MAX_PENDING = 300;
const MAX_PULL = 25;

const json = (status, value, headers = {}) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers }
});

const toHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
const sha256 = async text => toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));

// Constant-time comparison of the admin bearer token.
const sameSecret = (provided, expected) => {
  const a = new TextEncoder().encode(provided || '');
  const b = new TextEncoder().encode(expected || '');
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index++) diff |= (a[index] || 0) ^ (b[index] || 0);
  return diff === 0 && b.length >= 32;
};

async function readBody(request) {
  const declared = Number(request.headers.get('Content-Length'));
  if (declared > MAX_DIAGNOSTIC_BYTES) return { error: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { error: 400 };
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_DIAGNOSTIC_BYTES) { await reader.cancel(); return { error: 413 }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { text: new TextDecoder().decode(bytes) };
}

async function submitReport(request, env, store, now) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim() !== 'application/json') {
    return json(415, { error: '진단 리포트 형식이 아닙니다.' });
  }
  // Rate limit by a salted hash of the client address; the raw IP is never stored.
  const client = await sha256(`${env.RATE_SALT || ''}:${request.headers.get('CF-Connecting-IP') || 'unknown'}`);
  if (await store.recentSubmissions(client, now - RATE_LIMIT.windowMs) >= RATE_LIMIT.perClient) {
    return json(429, { error: '접수가 몰리고 있습니다. 잠시 후 다시 접수해주세요.' }, { 'Retry-After': '600' });
  }
  const { text, error } = await readBody(request);
  if (error === 413) return json(413, { error: '진단 리포트가 너무 큽니다.' });
  let report;
  try { report = parseDiagnosticReport(text); } catch { return json(400, { error: '리포트를 접수하지 못했습니다.' }); }

  const digest = await sha256(text);
  const existing = await store.findByReportId(report.reportId);
  if (existing) {
    // Resubmitting the same report after a lost response returns the original receipt.
    if (existing.digest !== digest) return json(400, { error: '이미 접수한 기록입니다. 새 기록을 시작해주세요.' });
    return json(201, { reportId: report.reportId, receiptId: existing.receiptId, receivedAt: existing.receivedAt });
  }
  if (await store.countPending() >= MAX_PENDING) {
    return json(503, { error: '접수 대기열이 가득 찼습니다. 잠시 후 다시 접수해주세요.' }, { 'Retry-After': '3600' });
  }
  const receipt = { reportId: report.reportId, receiptId: crypto.randomUUID(), receivedAt: new Date(now).toISOString() };
  await store.insert({ ...receipt, body: text, digest, client, at: now });
  return json(201, receipt);
}

export async function handleRequest(request, env, { store, now = Date.now(), notify = async () => {} } = {}) {
  const url = new URL(request.url);
  // Reports come from the desktop app, never from web pages.
  if (request.headers.get('Origin')) return json(403, { error: 'Windows 앱에서 접수해주세요.' });

  if (url.pathname === '/v1/status' && request.method === 'GET') return json(200, SERVICE_STATUS);
  if (url.pathname === '/v1/reports' && request.method === 'POST') {
    const response = await submitReport(request, env, store, now);
    if (response.status === 201) await notify().catch(() => {});
    return response;
  }

  if (url.pathname.startsWith('/v1/admin/')) {
    if (!sameSecret(request.headers.get('Authorization')?.replace(/^Bearer /, ''), env.ADMIN_TOKEN)) {
      return json(401, { error: 'unauthorized' });
    }
    if (url.pathname === '/v1/admin/reports' && request.method === 'GET') {
      const limit = Math.min(MAX_PULL, Math.max(1, Number(url.searchParams.get('limit')) || MAX_PULL));
      return json(200, { reports: await store.listPending(limit), pending: await store.countPending() });
    }
    const match = /^\/v1\/admin\/reports\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (match && request.method === 'DELETE') {
      await store.remove(match[1]);
      return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
    }
  }
  return json(404, { error: '찾을 수 없습니다.' });
}
