import test from 'node:test';
import assert from 'node:assert/strict';
import { discordCard } from '../automation/discordCards.mjs';

const base = { id: '12345678-1234-1234-1234-123456789abc', status: 'received', report: { symptom: 'other', description: 'PRIVATE TEXT', events: [] }, replay: { status: 'needs-more-data' } };
test('Discord cards omit private description and bind approval buttons to exact commit', () => {
  assert.ok(!JSON.stringify(discordCard(base)).includes('PRIVATE TEXT'));
  const sha = 'a'.repeat(40);
  const ready = discordCard({ ...base, status: 'review-ready', candidateSha: sha });
  const buttons = ready.components[0].components;
  assert.equal(buttons[0].custom_id, `review:${base.id}:${sha}`); assert.ok(buttons[0].custom_id.length <= 100);
});
test('a released report exposes no mutation button', () => {
  assert.equal(discordCard({ ...base, status: 'released' }).components.length, 0);
});
