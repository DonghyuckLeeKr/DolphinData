import http from 'node:http';
import { MAX_DIAGNOSTIC_BYTES } from '../src/services/diagnosticService.js';

// This listener accepts reports only. Never expose the administrator listener
// through a tunnel: it has separate authorization and release controls.
export async function createIntakeServer(controller, { port = 4175, limit = 30, clock = Date.now } = {}) {
  let windowStart = clock(); let requests = 0; let active = 0;
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const send = (code, value) => { if (!res.writableEnded) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); } };
    const pathname = req.url?.split('?')[0];
    if (req.headers.origin) { send(403, { error: 'Windows 앱에서 접수해주세요.' }); return; }
    if (req.method === 'GET' && pathname === '/v1/status') { send(200, { service: 'DolphinData diagnostic intake', schemaVersion: 1 }); return; }
    if (req.method !== 'POST' || pathname !== '/v1/reports') { send(404, { error: '찾을 수 없습니다.' }); return; }
    if (clock() - windowStart >= 60000) { windowStart = clock(); requests = 0; }
    if (++requests > limit || active >= 4) { res.setHeader('Retry-After', '60'); send(429, { error: '접수가 몰리고 있습니다. 1분 뒤 다시 접수해주세요.' }); return; }
    if (req.headers['content-type']?.split(';')[0] !== 'application/json') { send(415, { error: '진단 리포트 형식이 아닙니다.' }); return; }
    if (Number(req.headers['content-length']) > MAX_DIAGNOSTIC_BYTES) { send(413, { error: '진단 리포트가 너무 큽니다.' }); return; }
    active++;
    try {
      let size = 0; const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_DIAGNOSTIC_BYTES) { send(413, { error: '진단 리포트가 너무 큽니다.' }); return; }
        chunks.push(chunk);
      }
      const record = await controller.importReport(Buffer.concat(chunks).toString('utf8'));
      // No report contents, operator paths, credentials or approval state in the public receipt.
      send(201, { reportId: record.report.reportId, receiptId: record.id, receivedAt: record.createdAt });
    } catch { send(400, { error: '리포트를 접수하지 못했습니다. 기록을 확인하거나 잠시 후 다시 접수해주세요.' }); }
    finally { active--; }
  });
  server.requestTimeout = 15000; server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return { server, url: `http://127.0.0.1:${server.address().port}/v1/reports` };
}
