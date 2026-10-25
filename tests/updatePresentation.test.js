import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_KOREAN_UPDATE_NOTES, getKoreanUpdateNotes } from '../src/utils/updatePresentation.js';

test('Korean release notes are shown as provided', () => {
  assert.equal(getKoreanUpdateNotes('한글 업데이트 안내를 개선했습니다.'), '한글 업데이트 안내를 개선했습니다.');
});

test('missing or English release notes use a Korean fallback', () => {
  assert.equal(getKoreanUpdateNotes('Windows installer and signed bundle.'), DEFAULT_KOREAN_UPDATE_NOTES);
  assert.equal(getKoreanUpdateNotes(''), DEFAULT_KOREAN_UPDATE_NOTES);
});

test('Tauri default updater dialog is disabled in favor of the in-app dialog', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(config.tauri.updater.dialog, false);
});

test('release notes come from the matching CHANGELOG section as plain bullets', async () => {
  const { extractReleaseNotes } = await import('../scripts/release-notes.mjs');
  const changelog = '# 변경 이력\r\n\r\n## [1.4.1] - 2026-10-25\r\n\r\n- **트레이** 아이콘이 `수위`를 표시\r\n- 업데이트 창 개선\r\n\r\n---\r\n\r\n## [1.4.0] - 2026-10-25\r\n\r\n- 이전 내용\r\n';
  assert.equal(extractReleaseNotes(changelog, '1.4.1'), '• 트레이 아이콘이 수위를 표시\n• 업데이트 창 개선');
  assert.equal(extractReleaseNotes(changelog, '1.4.0'), '• 이전 내용');
  assert.throws(() => extractReleaseNotes(changelog, '9.9.9'), /no section/);
});

test('the current package version has release notes for the update dialog', async () => {
  const { extractReleaseNotes } = await import('../scripts/release-notes.mjs');
  const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.match(extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), version), /[가-힣]/);
});
