import http from 'node:http';
import path from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { AutomationController } from './controller.mjs';
import { safeEqual } from './policy.mjs';
import { MAX_DIAGNOSTIC_BYTES } from '../src/services/diagnosticService.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export async function createAdminServer(controller, { token = randomBytes(32).toString('hex'), port = 4174, discord = null } = {}) {
  let origin;
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
    const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) { send(403, { error: '접근이 거절되었습니다.' }); return; }
      const url = new URL(req.url, origin);
      if (!url.pathname.startsWith('/api/')) {
        const allowed = { '/': ['admin.html', 'text/html'], '/admin.js': ['admin.js', 'text/javascript'], '/admin.css': ['admin.css', 'text/css'] };
        const file = allowed[url.pathname]; if (!file || req.method !== 'GET') { send(404, { error: '찾을 수 없습니다.' }); return; }
        res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(await readFile(path.join(root, file[0]))); return;
      }
      if (!safeEqual(req.headers.authorization, `Bearer ${token}`)) { send(401, { error: '관리자 실행 창에서 열린 주소를 사용해주세요.' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/status') { send(200, { ...await controller.readiness(), discord: discord?.status || { connected: false, error: '디스코드 설정 대기' } }); return; }
      if (req.method === 'GET' && url.pathname === '/api/reports') { send(200, controller.list()); return; }
      if (req.method !== 'POST') { send(405, { error: '지원하지 않는 요청입니다.' }); return; }
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_DIAGNOSTIC_BYTES) { send(413, { error: '파일 한도 초과' }); req.destroy(); return; } chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (url.pathname === '/api/reports') { send(201, await controller.importReport(input)); return; }
      const match = /^\/api\/reports\/([a-f0-9-]+)\/(fix|refresh|approve|release)$/.exec(url.pathname);
      if (!match) { send(404, { error: '찾을 수 없습니다.' }); return; }
      const [, id, action] = match;
      const result = action === 'fix' ? await controller.startFix(id, 'local') : action === 'refresh' ? await controller.refresh(id)
        : action === 'approve' ? await controller.approveCode(id, { sha: input.sha, patchDigest: input.patchDigest, actor: 'local' })
        : await controller.approveRelease(id, 'local', input.runId);
      send(200, result);
    } catch (error) { send(400, { error: controller.safeError(error) }); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  return { server, url: `${origin}/#${token}`, token };
}

async function main() {
  const directory = path.resolve(process.env.DOLPHIN_AUTOMATION_HOME || path.join(process.env.LOCALAPPDATA || process.env.HOME, 'DolphinData', 'automation'));
  await mkdir(directory, { recursive: true });
  const controller = new AutomationController({ directory, repositoryRoot: path.resolve(root, '..'), codex: process.env.DOLPHIN_CODEX_PATH || 'codex' });
  await controller.init();
  let discord = null;
  if (process.env.DOLPHIN_DISCORD_TOKEN) {
    const config = JSON.parse((await readFile(path.join(directory, 'discord-config.json'), 'utf8')).replace(/^\uFEFF/, ''));
    const { startDiscord } = await import('./discord.mjs');
    try { discord = await startDiscord(controller, config, process.env.DOLPHIN_DISCORD_TOKEN); }
    catch { console.error('디스코드 연결 실패. 토큰과 서버 설정을 확인해주세요.'); }
  }
  const admin = await createAdminServer(controller, { discord });
  console.log(`DolphinData 개발 자동화 관리자: ${admin.url}`);
  console.log('주소에는 이번 실행의 관리자 키가 포함됩니다. 공유하지 마세요. 종료: Ctrl+C');
  let refreshing = false;
  const refreshTimer = setInterval(async () => {
    if (refreshing) return; refreshing = true;
    try { for (const r of controller.list().filter(r => ['preview-pending', 'release-pending'].includes(r.status))) await controller.refresh(r.id).catch(() => {}); }
    finally { refreshing = false; }
  }, 30000);
  const close = async () => { clearInterval(refreshTimer); await discord?.close(); admin.server.close(); };
  process.once('SIGINT', close); process.once('SIGTERM', close);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e.message); process.exitCode = 1; });
