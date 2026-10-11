import test from 'node:test';
import assert from 'node:assert/strict';
import { discordCard } from '../automation/discordCards.mjs';

const base = { id: '12345678-1234-1234-1234-123456789abc', status: 'received', report: { symptom: 'other', description: 'PRIVATE TEXT', events: [] }, replay: { status: 'needs-more-data' } };
test('private Discord cards display the description and bind approval buttons to exact commit', () => {
  assert.equal(discordCard(base).embeds[0].fields[0].value, 'PRIVATE TEXT');
  const sha = 'a'.repeat(40);
  const ready = discordCard({ ...base, status: 'review-ready', candidateSha: sha });
  const buttons = ready.components[0].components;
  assert.equal(buttons[0].custom_id, `review:${base.id}:${sha}`); assert.ok(buttons[0].custom_id.length <= 100);
});
test('Discord descriptions are redacted, bounded and cannot trigger mentions or fake links', () => {
  const card = discordCard({ ...base, report: { ...base.report, description: '@everyone [approve](https://evil.invalid) me@example.com 192.168.1.1 ' + '*'.repeat(950) }, error: '안내'.repeat(1000), aiSummary: '결과'.repeat(1000) });
  assert.deepEqual(card.allowedMentions, { parse: [] });
  const fields = card.embeds[0].fields;
  assert.ok(fields.every(f => f.value.length <= 1024));
  assert.ok(!fields[0].value.includes('me@example.com'));
  assert.ok(!fields[0].value.includes('192.168.1.1'));
  assert.ok(!fields[0].value.includes('@everyone'));
  assert.ok(fields[0].value.includes('\\[approve\\]'));
});
test('a no-change result shows its reason and allows retry on the same receipt', () => {
  const card = discordCard({ ...base, status: 'insufficient-evidence', error: '수정안 생성 안 됨', aiSummary: '개선할 화면을 확인해주세요.' });
  assert.equal(card.components[0].components[0].custom_id, `fix:${base.id}`);
  assert.equal(card.embeds[0].fields[2].value, '개선할 화면을 확인해주세요.');
});
test('a released report exposes no mutation button', () => {
  assert.equal(discordCard({ ...base, status: 'released' }).components.length, 0);
});
