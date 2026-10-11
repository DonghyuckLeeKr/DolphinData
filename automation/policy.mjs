import { createHash, timingSafeEqual } from 'node:crypto';

export const REPOSITORY = 'DonghyuckLeeKr/DolphinData';
export const isId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value);
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
export const digest = value => createHash('sha256').update(value).digest('hex');
export const safeEqual = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
export function assertAllowedChanges(entries) {
  if (!entries.length || entries.length > 30) throw new Error('수정 파일 수가 허용 범위를 벗어났습니다.');
  for (const { path, mode, status } of entries) {
    if (!/^(?:src\/.*\.(?:js|jsx|css)|src-tauri\/src\/.*\.rs|tests\/.*\.test\.js)$/.test(path)
      || path.includes('..') || path.includes('\\') || !['100644', '100755'].includes(mode) || !['A', 'M', 'D'].includes(status)) {
      throw new Error(`자동 수정 허용 범위 밖의 변경: ${path}`);
    }
  }
}
export function assertApproval(record, expectedSha, expectedDigest) {
  if (record.status !== 'review-ready' || !isSha(expectedSha) || record.candidateSha !== expectedSha
    || record.patchDigest !== expectedDigest || !record.previewRunId || record.previewConclusion !== 'success') {
    throw new Error('승인할 코드가 검사한 코드와 다르거나 검사가 완료되지 않았습니다.');
  }
}
export function authorizeDiscord(interaction, config) {
  return Boolean(config.guildId && config.channelId && config.ownerId
    && interaction.guildId === config.guildId && interaction.channelId === config.channelId && interaction.user?.id === config.ownerId);
}
