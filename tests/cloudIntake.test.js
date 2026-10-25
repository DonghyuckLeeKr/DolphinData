import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest, MAX_PENDING, RATE_LIMIT } from '../cloud/intake-worker/src/handler.js';
import { createDiagnosticRecorder } from '../src/services/diagnosticService.js';
import { DEFAULT_PROFILE } from '../src/services/storageService.js';

const ADMIN_TOKEN = 'a'.repeat(64);
const env = { ADMIN_TOKEN, RATE_SALT: 'salt' };

class MemoryStore {
  constructor() { this.reports = []; this.submissions = []; }
  async findByReportId(reportId) { return this.reports.find(r => r.reportId === reportId) || null; }
  async countPending() { return this.reports.length; }
  async recentSubmissions(client, since) { return this.submissions.filter(s => s.client === client && s.at >= since).length; }
  async insert(row) { this.reports.push(row); this.submissions.push({ client: row.client, at: row.at }); }
  async listPending(limit) { return this.reports.slice(0, limit).map(({ receiptId, receivedAt, body }) => ({ receiptId, receivedAt, body })); }
  async remove(receiptId) { this.reports = this.reports.filter(r => r.receiptId !== receiptId); }
}

const report = () => {
  const recorder = createDiagnosticRecorder();
  recorder.start({ profiles: [DEFAULT_PROFILE], activeProfileId: DEFAULT_PROFILE.id });
  recorder.observe({ connected: false }); recorder.stop();
  return JSON.stringify(recorder.export({ description: '연결이 끊깁니다', symptom: 'other' }));
};

const post = (body, { ip = '203.0.113.1', type = 'application/json', origin } = {}) => new Request('https://intake.example/v1/reports', {
  method: 'POST', body, headers: { 'Content-Type': type, 'CF-Connecting-IP': ip, ...(origin ? { Origin: origin } : {}) }
});
const admin = (path, { method = 'GET', token = ADMIN_TOKEN } = {}) => new Request(`https://intake.example${path}`, {
  method, headers: token ? { Authorization: `Bearer ${token}` } : {}
});

test('status matches the contract the desktop app checks', async () => {
  const response = await handleRequest(new Request('https://intake.example/v1/status'), env, { store: new MemoryStore() });
  assert.deepEqual(await response.json(), { service: 'DolphinData diagnostic intake', schemaVersion: 1 });
});

test('a valid report is stored once and resubmitting returns the same receipt', async () => {
  const store = new MemoryStore(); let notified = 0;
  const body = report();
  const first = await handleRequest(post(body), env, { store, notify: async () => { notified++; } });
  assert.equal(first.status, 201);
  const receipt = await first.json();
  assert.equal(receipt.reportId, JSON.parse(body).reportId);
  assert.match(receipt.receiptId, /^[0-9a-f-]{36}$/);
  const again = await handleRequest(post(body), env, { store });
  assert.deepEqual(await again.json(), receipt);
  assert.equal(store.reports.length, 1);
  assert.equal(notified, 1);
  // The raw client address is never stored, only a salted hash.
  assert.ok(!JSON.stringify(store.submissions).includes('203.0.113.1'));
});

test('junk, browser requests, wrong types and oversized bodies are rejected', async () => {
  const store = new MemoryStore();
  assert.equal((await handleRequest(post('{"schemaVersion":1}'), env, { store })).status, 400);
  assert.equal((await handleRequest(post(report(), { origin: 'https://evil.example' }), env, { store })).status, 403);
  assert.equal((await handleRequest(post(report(), { type: 'text/plain' }), env, { store })).status, 415);
  assert.equal((await handleRequest(post('x'.repeat(300 * 1024)), env, { store })).status, 413);
  assert.equal(store.reports.length, 0);
});

test('each client is rate limited and the queue has a ceiling', async () => {
  const store = new MemoryStore();
  for (let i = 0; i < RATE_LIMIT.perClient; i++) assert.equal((await handleRequest(post(report()), env, { store })).status, 201);
  assert.equal((await handleRequest(post(report()), env, { store })).status, 429);
  // Another client is unaffected, and the limit resets after the window.
  assert.equal((await handleRequest(post(report(), { ip: '198.51.100.7' }), env, { store })).status, 201);
  assert.equal((await handleRequest(post(report()), env, { store, now: Date.now() + RATE_LIMIT.windowMs + 1 })).status, 201);

  const full = new MemoryStore();
  full.reports = Array.from({ length: MAX_PENDING }, (_, i) => ({ reportId: `x${i}`, receiptId: `r${i}` }));
  assert.equal((await handleRequest(post(report(), { ip: '192.0.2.9' }), env, { store: full })).status, 503);
});

test('only the admin token can list and delete pending reports', async () => {
  const store = new MemoryStore();
  const { receiptId } = await (await handleRequest(post(report()), env, { store })).json();
  assert.equal((await handleRequest(admin('/v1/admin/reports', { token: null }), env, { store })).status, 401);
  assert.equal((await handleRequest(admin('/v1/admin/reports', { token: 'b'.repeat(64) }), env, { store })).status, 401);
  // A short or missing server secret never authorizes anyone.
  assert.equal((await handleRequest(admin('/v1/admin/reports', { token: '' }), { ADMIN_TOKEN: '' }, { store })).status, 401);
  const listed = await (await handleRequest(admin('/v1/admin/reports'), env, { store })).json();
  assert.equal(listed.pending, 1);
  assert.equal(listed.reports[0].receiptId, receiptId);
  assert.equal((await handleRequest(admin(`/v1/admin/reports/${receiptId}`, { method: 'DELETE' }), env, { store })).status, 204);
  assert.equal(store.reports.length, 0);
});
