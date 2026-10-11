import test from 'node:test';
import assert from 'node:assert/strict';
import { publishDiscordRecord, loadNotificationCache, recoverNotification } from '../automation/discordNotifications.mjs';

const id = 'd9289b28-777d-46dd-a708-97a105c71bd0', sha = 'a'.repeat(40);
const record = (status = 'review-ready') => ({ id, status, candidateSha: sha, report: { symptom: 'other', description: '화면 개선 요청', events: [{}] }, replay: { status: 'needs-more-data' }, dailyRunDate: '2026-10-11' });
function mock() {
  const sent = [], edited = [], messages = new Map(), notices = new Map();
  return { sent, edited, messages, notices, channel: { send: async card => { sent.push(card); return { id: `155870086404519530${sent.length}` }; }, messages: { edit: async (id, card) => { edited.push({ id, card }); return { id }; } } } };
}

test('successful CI creates one new approval request per SHA; repeated updates reuse it', async () => {
  const m = mock(); m.messages.set(id, '1558700864045195300');
  await publishDiscordRecord(m.channel, record(), m.messages, m.notices);
  assert.equal(m.sent.length, 1); assert.ok(m.sent[0].content.startsWith('**DolphinData · 승인 요청**'));
  assert.ok(m.sent[0].components[0].components.some(b => b.custom_id === `review:${id}:${sha}`));
  assert.ok(m.edited[0].card.components.every(row => row.components.every(b => !b.custom_id?.startsWith('review:'))));
  assert.equal(m.sent[0].enforceNonce, true); assert.equal(m.sent[0].nonce.length, 24);
  await publishDiscordRecord(m.channel, record(), m.messages, m.notices); assert.equal(m.sent.length, 1);
  await publishDiscordRecord(m.channel, { ...record(), candidateSha: 'b'.repeat(40) }, m.messages, m.notices); assert.equal(m.sent.length, 2);
});

test('failed CI never requests approval and send failure remains retryable', async () => {
  const m = mock(); await publishDiscordRecord(m.channel, record('failed'), m.messages, m.notices);
  assert.ok(!m.sent[0].content.includes('승인 요청')); assert.equal(m.notices.size, 0);
  const send = m.channel.send; m.channel.send = async () => { throw new Error('offline'); };
  await assert.rejects(publishDiscordRecord(m.channel, record(), m.messages, m.notices)); assert.equal(m.notices.size, 0);
  m.channel.send = send; await publishDiscordRecord(m.channel, record(), m.messages, m.notices); assert.equal(m.notices.size, 1);
});

test('legacy cache migrates; recovery preserves bot-authored approval requests after restart', () => {
  const m = mock(); loadNotificationCache({ [id]: '1558700864045195300', invalid: 'junk' }, m.messages, m.notices); assert.equal(m.messages.size, 1);
  recoverNotification({ id: '1558700864045195301', author: { id: 'bot' }, content: `**DolphinData · 승인 요청**\n리포트: \`${id}\`\n검사할 코드: \`${sha}\`` }, 'bot', m.messages, m.notices);
  assert.equal(m.notices.get(`${id}:${sha}`), '1558700864045195301');
  recoverNotification({ id: '1558700864045195302', author: { id: 'outsider' }, content: `**DolphinData · 승인 요청**\n리포트: \`${id}\`\n검사할 코드: \`${sha}\`` }, 'bot', m.messages, m.notices);
  assert.equal(m.notices.get(`${id}:${sha}`), '1558700864045195301');
  const restored = mock(); loadNotificationCache({ schemaVersion: 2, messages: Object.fromEntries(m.messages), reviewNotices: Object.fromEntries(m.notices) }, restored.messages, restored.notices);
  assert.deepEqual(restored.notices, m.notices); assert.deepEqual(restored.messages, m.messages);
});
