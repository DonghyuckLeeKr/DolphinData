import { SYMPTOMS, redactDescription } from '../src/services/diagnosticService.js';
import { canRequestFix } from './fixRequest.mjs';

// Strip control and bidirectional characters so submitted text cannot disguise approval UI.
const discordText = text => [...redactDescription(text)].filter(c => !((c.charCodeAt(0) < 32 && c !== '\n' && c !== '\t')
  || c.charCodeAt(0) === 127 || /[\u202a-\u202e\u2066-\u2069]/.test(c))).join('')
  .replace(/([\\`*_~|>[\]()])/g, '\\$1').replace(/@/g, '@\u200b').slice(0, 950);

// Discord API component data stays independent of the optional bot library.
export function discordCard(record) {
  const labels = { received: '리포트 접수', fixing: '자동 수정 중', 'preview-pending': 'Windows 검사 중', 'review-ready': '수정 내용 검토 필요',
    'release-pending': '배포 승인 대기', released: '배포 완료', failed: '작업 실패', 'release-failed': '배포 실패', 'insufficient-evidence': '추가 확인 필요', interrupted: '중단됨' };
  const lines = [`**DolphinData · ${labels[record.status] || record.status}**`, `리포트: \`${record.id}\``,
    `문제: ${SYMPTOMS[record.report.symptom]}`, `기록 확인: ${record.report.symptom === 'other' ? '일반·디자인 요청의 참고 기록' : record.replay.status}`, `기록: ${record.report.events.length}개`];
  if (record.candidateSha) lines.push(`검사할 코드: \`${record.candidateSha}\``);
  if (record.patchDigest) lines.push(`수정본 SHA256: \`${record.patchDigest}\``);
  const fields = [{ name: '문제 설명', value: discordText(record.report.description) || '입력된 설명 없음' }];
  if (record.error) fields.push({ name: '처리 안내', value: discordText(record.error) || '관리자 화면에서 확인해주세요.' });
  if (record.aiSummary) fields.push({ name: 'AI 처리 결과', value: discordText(record.aiSummary) });
  const buttons = [];
  const button = (label, id, style = 1) => buttons.push({ type: 2, custom_id: id, label, style });
  const link = (label, url) => { if (url?.startsWith('https://github.com/DonghyuckLeeKr/DolphinData/')) buttons.push({ type: 2, label, url, style: 5 }); };
  if (canRequestFix(record)) button(record.status === 'received' ? '자동 수정 요청' : '자동 수정 다시 요청', `fix:${record.id}`);
  link('변경 내용 확인', record.prUrl); link('검사·설치파일 확인', record.previewUrl);
  if (record.status === 'review-ready') button('수정 승인 절차', `review:${record.id}:${record.candidateSha}`, 3);
  if (record.status === 'release-pending' && record.releaseRunId) {
    link('배포 상태 확인', record.releaseUrl); button('배포 승인 절차', `release:${record.id}:${record.releaseRunId}`, 3);
  }
  return { content: lines.join('\n'), embeds: [{ fields, footer: { text: '자동 수정 요청 시 설명과 익명화한 기록을 AI가 분석합니다. 수정·배포는 별도 승인 후 진행됩니다.' } }],
    allowedMentions: { parse: [] }, components: buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [] };
}
