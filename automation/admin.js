const isLocalAdmin = location.protocol === 'http:' && location.hostname === '127.0.0.1';
const sessionKey = 'dolphindata-admin-session';
let token = '';
function readAdminToken() {
  if (!isLocalAdmin) return;
  const supplied = location.hash.slice(1);
  try {
    if (/^[a-f0-9]{64}$/.test(supplied)) sessionStorage.setItem(sessionKey, supplied);
    token = /^[a-f0-9]{64}$/.test(supplied) ? supplied : sessionStorage.getItem(sessionKey) || '';
  } catch { token = supplied; }
  history.replaceState(null, '', location.pathname);
}
readAdminToken();
const message = document.querySelector('#message');
const labels = { received: '리포트 접수', fixing: '자동 수정 중', 'preview-pending': 'Windows 검사 중', 'review-ready': '수정 검토 필요',
  approving: '수정 승인 처리 중', 'release-pending': '배포 승인 대기', released: '배포 완료', failed: '작업 실패', 'release-failed': '배포 실패',
  'approval-failed': '승인 처리 실패', 'insufficient-evidence': '추가 확인 필요', interrupted: '중단됨' };
const replayLabels = { reproduced: '기록에서 문제 재현', 'not-reproduced': '기록에서 문제 미재현', 'needs-more-data': '추가 기록 또는 실제 환경 확인 필요' };
async function api(url, data) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, ...(data ? { 'Content-Type': 'application/json' } : {}) },
    signal: AbortSignal.timeout(15000), ...(data ? { method: 'POST', body: JSON.stringify(data) } : {}) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
}
const element = (tag, text, className) => { const e = document.createElement(tag); if (text) e.textContent = text; if (className) e.className = className; return e; };
function renderStatus(status) {
  const target = document.querySelector('#connections'); target.replaceChildren();
  for (const [label, good, text] of [['자동 수정', status.codex, status.codex ? 'Codex 로그인 확인' : 'Codex 로그인 필요'],
    ['GitHub 검사·배포', status.previewWorkflow && status.releaseApproval, status.previewWorkflow && status.releaseApproval ? '검사 작업·승인자 설정 확인' : 'main 반영·승인자 설정 필요'],
    ['디스코드', status.discord.connected, status.discord.connected ? '봇 연결됨' : status.discord.error || '연결 설정 대기'],
    ['외부 앱 접수', status.publicIntake?.connected, status.publicIntake?.connected ? '무료 인터넷 접수 연결됨' : status.publicIntake?.error || '연결 설정 대기']]) {
    const card = element('div', '', 'connection'); card.append(element('span', label), element('strong', text, good ? 'good' : 'pending')); target.append(card);
  }
}
function renderReports(records) {
  const target = document.querySelector('#reports'); target.replaceChildren();
  if (!records.length) { target.append(element('div', '아직 받은 리포트가 없습니다. 앱에서 문제 접수를 누르면 여기에 나타납니다.', 'empty')); return; }
  for (const r of [...records].reverse()) {
    const card = element('article', '', 'report'); const head = element('div', '', 'report-head');
    head.append(element('h3', `리포트 ${r.id.slice(0, 8)}`), element('span', labels[r.status] || r.status, 'badge')); card.append(head);
    card.append(element('div', `앱 ${r.report.appVersion} · ${r.report.environment.platform} · 기록 ${r.report.events.length}개 · ${r.report.symptom === 'other' ? '일반·디자인 요청의 참고 기록' : replayLabels[r.replay.status]}`, 'details'));
    card.append(element('div', r.report.description || '사용자 설명 없음', 'description'));
    if (r.candidateSha) card.append(element('div', `검사할 코드: ${r.candidateSha}\n수정본 SHA256: ${r.patchDigest}`, 'details'));
    if (r.error) card.append(element('p', r.error, 'error'));
    if (r.aiSummary) { card.append(element('h4', 'AI 처리 결과'), element('div', r.aiSummary, 'description')); }
    const detail = element('details'); detail.append(element('summary', '진단 기록과 승인 이력 확인'), element('pre', JSON.stringify({ symptom: r.report.symptom, replay: r.replay, audit: r.audit }, null, 2))); card.append(detail);
    const actions = element('div', '', 'actions');
    const button = (label, action, data = {}, approve = '') => {
      const b = element('button', label, approve ? 'danger' : ''); b.type = 'button';
      b.onclick = async () => { if (approve && !confirm(approve)) return; b.disabled = true; message.textContent = '처리 중…';
        try { await api(`/api/reports/${r.id}/${action}`, data); message.textContent = '요청을 처리했습니다.'; await refresh(); }
        catch (e) { message.textContent = e.message; } finally { b.disabled = false; } }; actions.append(b);
    };
    const link = (label, url) => { if (!url?.startsWith('https://github.com/DonghyuckLeeKr/DolphinData/')) return; const a = element('a', label, 'button'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; actions.append(a); };
    if (r.canRequestFix) button(r.status === 'received' ? '자동 수정 요청' : '자동 수정 다시 요청', 'fix');
    link('변경 내용 확인', r.prUrl); link('검사·설치파일 확인', r.previewUrl); link('배포 상태 확인', r.releaseUrl);
    if (r.status === 'review-ready') button('수정 검토 완료 · 승인', 'approve', { sha: r.candidateSha, patchDigest: r.patchDigest }, `변경 내용과 검사 설치파일을 확인했나요?\n승인한 수정본을 main에 병합합니다.\n코드: ${r.candidateSha}\n배포 승인은 별도로 필요합니다.`);
    if (r.status === 'release-pending' && r.releaseRunId) button('이 버전 배포 승인', 'release', { runId: r.releaseRunId }, `코드 ${r.releaseSha}의 서명된 설치파일을 빌드하고 사용자에게 배포합니다. 승인할까요?`);
    if (['preview-pending', 'release-pending'].includes(r.status)) button('검사 상태 확인', 'refresh');
    card.append(actions); target.append(card);
  }
}
async function refresh() {
  if (!isLocalAdmin || !token) {
    message.textContent = !isLocalAdmin ? 'HTML 파일 미리보기에서는 접수 목록을 불러올 수 없습니다. automation 폴더의 Start-Automation.cmd를 실행하고 열린 브라우저를 사용해주세요.'
      : '관리자 인증이 필요합니다. Start-Automation.cmd 실행 창의 원래 주소를 다시 열어주세요.';
    return;
  }
  const [records, status] = await Promise.allSettled([api('/api/reports'), api('/api/status')]);
  if (records.status === 'fulfilled') renderReports(records.value);
  if (status.status === 'fulfilled') renderStatus(status.value);
  const failures = [records, status].filter(r => r.status === 'rejected');
  message.textContent = failures.length ? failures.map(r => r.reason.message).join(' · ') : `리포트 ${records.value.length}개 · ${new Date().toLocaleTimeString('ko-KR')} 확인`;
}
document.querySelector('#refresh').onclick = refresh;
window.addEventListener('hashchange', () => { readAdminToken(); refresh(); });
document.querySelector('#file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (!isLocalAdmin || !token) throw new Error('Start-Automation.cmd에서 열린 관리자 화면을 사용해주세요.'); if (file.size > 256 * 1024) throw new Error('256KB 이하의 진단 파일만 가져올 수 있습니다.'); await api('/api/reports', JSON.parse(await file.text())); message.textContent = '리포트를 가져왔습니다.'; await refresh(); }
  catch (e) { message.textContent = e.message; } finally { event.target.value = ''; }
};
refresh(); setInterval(refresh, 15000);
