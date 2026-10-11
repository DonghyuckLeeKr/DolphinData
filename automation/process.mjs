import { spawn } from 'node:child_process';
// Arguments never pass through a shell. In particular, report text is stdin only.
export function run(file, args, { cwd, input, env = process.env, timeout = 120000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = ''; let error = ''; let size = 0; let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill();
    };
    const timer = setTimeout(stop, timeout);
    const collect = target => chunk => { size += chunk.length; if (size > maxBytes) stop(); else if (target === 'out') output += chunk; else error += chunk; };
    child.stdout.on('data', collect('out')); child.stderr.on('data', collect('err'));
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      if (stopped) reject(new Error('작업 시간 또는 출력 한도를 초과했습니다.'));
      else if (code !== 0) reject(new Error(`${file} 작업 실패 (${code}): ${error.slice(-1500)}`));
      else resolve(output.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
export const agentEnvironment = env => Object.fromEntries(Object.entries(env).filter(([k]) =>
  ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'HOME', 'CODEX_HOME'].includes(k.toUpperCase())));
