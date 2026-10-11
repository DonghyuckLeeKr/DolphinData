import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { run, agentEnvironment } from './process.mjs';
import { REPOSITORY } from './policy.mjs';

export function intakeConfig(address) {
  const url = new URL(address);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(url.hostname)
    || url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('외부 접수 주소를 확인하지 못했습니다.');
  return { schemaVersion: 1, endpoint: `${url.origin}/v1/reports` };
}

export async function publishIntake(address, execute = run) {
  const config = intakeConfig(address);
  const endpoint = `repos/${REPOSITORY}/contents/support/diagnostic-intake.json`;
  // Only this public routing file is updated. No credentials, report content,
  // workflow, application code or release approval is sent to GitHub.
  const file = JSON.parse(await execute('gh', ['api', `${endpoint}?ref=main`]));
  const previous = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8'));
  if (JSON.stringify(previous) === JSON.stringify(config)) return;
  await execute('gh', ['api', endpoint, '--method', 'PUT', '--input', '-'], { input: JSON.stringify({
    message: 'chore: refresh diagnostic intake address', branch: 'main', sha: file.sha,
    content: Buffer.from(JSON.stringify(config, null, 2) + '\n').toString('base64')
  }) });
}

export async function startPublicIntake(directory, { publish = true } = {}) {
  let setup;
  try { setup = JSON.parse(await readFile(path.join(directory, 'free-intake.json'), 'utf8')); } catch { return null; }
  if (!setup.enabled) return null;
  const executable = path.join(directory, 'tools', 'cloudflared.exe');
  const status = { connected: false, error: '' };
  let child = null; let closing = false;
  const connect = async () => {
    status.connected = false;
    try {
      const address = await new Promise((resolve, reject) => {
        let output = ''; let resolved = false;
        const timer = setTimeout(() => { if (!resolved) { child?.kill(); reject(new Error('timeout')); } }, 45000);
        child = spawn(executable, ['tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:4175', '--protocol', 'http2'],
          { shell: false, windowsHide: true, env: agentEnvironment(process.env), stdio: ['ignore', 'ignore', 'pipe'] });
        child.stderr.on('data', chunk => {
          output = (output + chunk.toString()).slice(-8192);
          const match = output.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
          if (match && !resolved) { resolved = true; clearTimeout(timer); resolve(match[0]); }
        });
        child.on('error', () => { clearTimeout(timer); reject(new Error('start failed')); });
        child.on('close', () => {
          clearTimeout(timer); status.connected = false;
          if (!resolved) reject(new Error('connection closed'));
          if (!closing) status.error = '외부 접수 연결이 종료되었습니다. 자동화 도구를 다시 실행해주세요.';
        });
      });
      const config = intakeConfig(address);
      // DNS and tunnel registration can finish after the URL is printed.
      let ready = false;
      for (let attempt = 0; attempt < 12 && !closing; attempt++) {
        try {
          const response = await fetch(new URL('/v1/status', address), { redirect: 'error', signal: AbortSignal.timeout(5000) });
          if (response.ok && (await response.json()).service === 'DolphinData diagnostic intake') { ready = true; break; }
        } catch { /* Retry registration, without forwarding any report. */ }
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
      if (!ready || closing) throw new Error('not ready');
      await writeFile(path.join(directory, 'public-intake.json'), JSON.stringify(config, null, 2));
      if (publish) await publishIntake(address);
      status.connected = true; status.error = '';
      console.log(publish ? '무료 외부 접수 연결 및 앱 접수 주소 갱신 완료.' : '무료 외부 접수 연결 검증 완료. 앱 접수 주소 등록 대기 중.');
    } catch {
      status.error = '무료 외부 접수 연결 실패. 인터넷·GitHub 로그인과 연결 도구 설정을 확인해주세요.';
      console.error(status.error);
      child?.kill();
    }
  };
  void connect();
  return { status, close() { closing = true; child?.kill(); } };
}
