import { SYMPTOMS, redactDescription } from '../src/services/diagnosticService.js';
import { canRequestFix } from './fixRequest.mjs';

// Strip control and bidirectional characters so submitted text cannot disguise approval UI.
const discordText = text => [...redactDescription(text)].filter(c => !((c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t')
  || c.charCodeAt(0) === 127 || /[\u202a-\u202e\u2066-\u2069]/.test(c))).join('')
  .replace(/([\\`*_~|>[\]()])/g, '\\$1').replace(/@/g, '@\u200b').slice(0, 950);

// Discord API component data stays independent of the optional bot library.
export function discordCard(record) {
  const labels = { received: '리포트 접수', fixing: '자동 수정 중', 'preview-pending': 'Windows 검사 중', 'review-ready': '수정 내용 검토 필요',
    'release-pending': '배포 승인 대기', released: '배포 완료', failed: '작업 실패', 'release-failed': '배포 실패', 'insufficient-evidence': '추가 확인 필요', interrupted: '중단됨', batched: '일괄 처리에 포함', 'candidate-closed': '수정안 닫힘', retired: '접수별 대기로 복귀' };
  const lines = [`**DolphinData · ${labels[record.status] || record.status}**`, `리포트: \`${record.id}\``,
    ...(record.kind === 'batch' ? [`문제: ${[...new Set(record.reports.map(r => SYMPTOMS[r.symptom]))].join(' · ')}`,
      `참고 기록: 총 ${record.reports.reduce((sum, r) => sum + (r.eventCount || 0), 0)}개 · 접수별 설명과 결과를 함께 확인해주세요.`]
      : [`문제: ${SYMPTOMS[record.report.symptom]}`, `기록 확인: ${record.report.symptom === 'other' ? '일반·디자인 요청의 참고 기록' : record.replay.status}`, `기록: ${record.report.events.length}개`])];
  if (record.candidateSha) lines.push(`검사할 코드: \`${record.candidateSha}\``);
  if (record.patchDigest) lines.push(`수정본 SHA256: \`${record.patchDigest}\``);
  if (record.kind === 'batch') lines.splice(1, 0, `선택한 접수 ${record.reportIds.length}건을 하나의 수정안으로 처리합니다.`);
  if (record.batchId) lines.push(`일괄 수정: \`${record.batchId}\` · ${labels[record.batchStatus] || record.batchStatus}`);
  if (record.dailyRunDate) lines.push(`일일 자동 수정: ${record.dailyRunDate} · 한국 시간 21:00${record.dailyRemaining ? ` · 다음 처리 대기 ${record.dailyRemaining}건` : ''}`);
  if (record.triagePending) lines.push('검토 전 접수입니다. 내용을 확인한 뒤 일일 자동 처리에 포함해주세요.');
  else if (record.autoProcessExcluded) lines.push('일일 자동 처리에서 제외된 접수입니다.');
  const fields = record.kind === 'batch' ? record.reports.map(r => ({ name: `문제 설명 · ${r.id.slice(0, 8)}`,
    value: discordText(r.description).slice(0, 280) || '입력된 설명 없음' })) : [{ name: '문제 설명', value: discordText(record.report.description) || '입력된 설명 없음' }];
  if (record.error) fields.push({ name: '처리 안내', value: discordText(record.error) || '관리자 화면에서 확인해주세요.' });
  if (record.aiSummary) fields.push({ name: 'AI 처리 결과', value: discordText(record.aiSummary) });
  const buttons = [];
  const button = (label, id, style = 1) => buttons.push({ type: 2, custom_id: id, label, style });
  const link = (label, url) => { if (url?.startsWith('https://github.com/DonghyuckLeeKr/DolphinData/')) buttons.push({ type: 2, label, url, style: 5 }); };
  if (canRequestFix(record)) button(record.kind === 'batch' ? '일괄 수정 다시 요청' : record.status === 'received' ? '자동 수정 요청' : '자동 수정 다시 요청', `fix:${record.id}`);
  if (record.triagePending && record.status === 'received') button('일일 자동 처리에 포함', `include:${record.id}`, 3);
  link('함께 처리한 수정안 확인', record.batchPrUrl);
  link('변경 내용 확인', record.prUrl); link('검사·설치파일 확인', record.previewUrl);
  if (record.status === 'candidate-closed') button('접수 대기로 돌리기', `requeue:${record.id}`);
  if (record.status === 'candidate-closed' && record.kind === 'batch') button('같은 묶음 다시 수정', `retry:${record.id}`);
  if (record.status === 'review-ready') button('수정 승인 절차', `review:${record.id}:${record.candidateSha}`, 3);
  if (record.status === 'release-pending' && record.releaseRunId) {
    link('배포 상태 확인', record.releaseUrl); button('배포 승인 절차', `release:${record.id}:${record.releaseRunId}`, 3);
  }
  return { content: lines.join('\n'), embeds: [{ fields, footer: { text: '자동 수정 요청 시 설명과 익명화한 기록을 AI가 분석합니다. 수정·배포는 별도 승인 후 진행됩니다.' } }],
    allowedMentions: { parse: [] }, components: buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [] };
}
