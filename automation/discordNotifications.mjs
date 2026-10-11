import { discordCard } from './discordCards.mjs';
import { digest, isId, isSha } from './policy.mjs';

export const reviewNoticeKey = record => record.status === 'review-ready' && isSha(record.candidateSha) ? `${record.id}:${record.candidateSha}` : null;
export function loadNotificationCache(cache, messageIds, reviewNotices) {
  for (const [id, message] of Object.entries(cache.schemaVersion === 2 ? cache.messages || {} : cache)) {
    if (isId(id) && /^\d{17,22}$/.test(message)) messageIds.set(id, message);
  }
  for (const [key, message] of Object.entries(cache.schemaVersion === 2 ? cache.reviewNotices || {} : {})) {
    const [id, sha] = key.split(':');
    if (isId(id) && isSha(sha) && /^\d{17,22}$/.test(message)) reviewNotices.set(key, message);
  }
}
export function recoverNotification(message, botId, messageIds, reviewNotices) {
  const id = message.content.match(/리포트: `([a-f0-9-]+)`/)?.[1];
  if (message.author.id !== botId || !isId(id)) return;
  if (!messageIds.has(id)) messageIds.set(id, message.id);
  const sha = message.content.match(/검사할 코드: `([a-f0-9]{40})`/)?.[1];
  if (message.content.startsWith('**DolphinData · 승인 요청**') && isSha(sha)) {
    const key = `${id}:${sha}`;
    if (!reviewNotices.has(key)) reviewNotices.set(key, message.id);
  }
}

export async function publishDiscordRecord(channel, record, messageIds, reviewNotices) {
  const card = discordCard(record), noticeKey = reviewNoticeKey(record);
  const existing = messageIds.get(record.id);
  if (noticeKey && !reviewNotices.has(noticeKey)) {
    // A card edit does not notify the owner. Send one new request per tested SHA.
    if (existing) {
      const progress = { ...card, components: card.components.map(row => ({ ...row,
        components: row.components.filter(button => !button.custom_id?.startsWith('review:')) })).filter(row => row.components.length) };
      try { await channel.messages.edit(existing, progress); } catch (error) { if (error.code !== 10008) throw error; }
    }
    const message = await channel.send({ ...card, content: `**DolphinData · 승인 요청**\n${card.content}`,
      nonce: digest(noticeKey).slice(0, 24), enforceNonce: true });
    messageIds.set(record.id, message.id); reviewNotices.set(noticeKey, message.id);
    return message;
  }
  const target = noticeKey ? reviewNotices.get(noticeKey) : existing;
  let message;
  if (target) {
    try { message = await channel.messages.edit(target, noticeKey ? { ...card, content: `**DolphinData · 승인 요청**\n${card.content}` } : card); }
    catch (error) { if (error.code !== 10008) throw error; }
  }
  if (!message) {
    message = await channel.send(noticeKey ? { ...card, content: `**DolphinData · 승인 요청**\n${card.content}`, nonce: digest(noticeKey).slice(0, 24), enforceNonce: true } : card);
    if (noticeKey) reviewNotices.set(noticeKey, message.id);
  }
  messageIds.set(record.id, message.id); return message;
}
