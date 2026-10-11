import { SYMPTOMS } from '../src/services/diagnosticService.js';

// Discord API component data stays independent of the optional bot library.
export function discordCard(record) {
  const labels = { received: '리포트 접수', fixing: '자동 수정 중', 'preview-pending': 'Windows 검사 중', 'review-ready': '수정 내용 검토 필요',
    'release-pending': '배포 승인 대기', released: '배포 완료', failed: '작업 실패', 'release-failed': '배포 실패', 'insufficient-evidence': '추가 기록 필요', interrupted: '중단됨' };
  const lines = [`**DolphinData · ${labels[record.status] || record.status}**`, `리포트: \`${record.id}\``,
    `문제: ${SYMPTOMS[record.report.symptom]}`, `재생 결과: ${record.replay.status}`, `기록: ${record.report.events.length}개`];
  if (record.candidateSha) lines.push(`검사할 코드: \`${record.candidateSha}\``);
  if (record.patchDigest) lines.push(`수정본 SHA256: \`${record.patchDigest}\``);
  if (record.error) lines.push('오류 상세는 이 PC의 관리자 화면에서 확인해주세요.');
  const buttons = [];
  const button = (label, id, style = 1) => buttons.push({ type: 2, custom_id: id, label, style });
  const link = (label, url) => { if (url?.startsWith('https://github.com/DonghyuckLeeKr/DolphinData/')) buttons.push({ type: 2, label, url, style: 5 }); };
  if (record.status === 'received') button('자동 수정 요청', `fix:${record.id}`);
  link('변경 내용 확인', record.prUrl); link('검사·설치파일 확인', record.previewUrl);
  if (record.status === 'review-ready') button('수정 승인 절차', `review:${record.id}:${record.candidateSha}`, 3);
  if (record.status === 'release-pending' && record.releaseRunId) {
    link('배포 상태 확인', record.releaseUrl); button('배포 승인 절차', `release:${record.id}:${record.releaseRunId}`, 3);
  }
  return { content: lines.join('\n'), allowedMentions: { parse: [] }, components: buttons.length ? [{ type: 1, components: buttons.slice(0, 5) }] : [] };
}
