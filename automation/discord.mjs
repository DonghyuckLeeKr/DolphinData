import { Client, GatewayIntentBits, Events, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, StringSelectMenuBuilder } from 'discord.js';
import { authorizeDiscord, isId } from './policy.mjs';
import { MAX_DIAGNOSTIC_BYTES, redactDescription } from '../src/services/diagnosticService.js';
import { loadNotificationCache, recoverNotification, reviewNoticeKey, publishDiscordRecord } from './discordNotifications.mjs';
import { MAX_BATCH_REPORTS } from './fixRequest.mjs';
import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function startDiscord(controller, config, token) {
  if (!token || !config.guildId || !config.channelId || !config.ownerId) return null;
  if (![config.guildId, config.channelId, config.ownerId].every(v => /^\d{17,22}$/.test(v))) throw new Error('디스코드 ID 형식이 올바르지 않습니다.');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const status = { connected: false, error: '' };
  const messageIds = new Map(), reviewNotices = new Map();
  const notificationFile = path.join(controller.directory, `discord-messages-${config.channelId}.json`);
  try {
    loadNotificationCache(JSON.parse(await readFile(notificationFile, 'utf8')), messageIds, reviewNotices);
  } catch { /* First start, or a corrupt notification cache. Reports remain intact. */ }
  const publishing = new Map(); let notificationSave = Promise.resolve();
  let channel;
  const publishOne = async record => {
    if (!channel) return;
    try {
      await publishDiscordRecord(channel, record, messageIds, reviewNotices);
      status.lastReceiptId = record.id;
      const snapshot = JSON.stringify({ schemaVersion: 2, messages: Object.fromEntries(messageIds), reviewNotices: Object.fromEntries(reviewNotices) });
      notificationSave = notificationSave.catch(() => {}).then(async () => {
        await writeFile(`${notificationFile}.tmp`, snapshot, { mode: 0o600 }); await rename(`${notificationFile}.tmp`, notificationFile);
      });
      await notificationSave;
      status.error = '';
    } catch { status.error = '디스코드 카드 전송 실패: 채널 권한·연결을 확인해주세요.'; }
  };
  const publish = record => {
    const task = (publishing.get(record.id) || Promise.resolve()).then(() => publishOne(record));
    publishing.set(record.id, task);
    return task;
  };
  client.on(Events.Error, () => { status.error = '디스코드 연결 오류'; });
  client.once(Events.ClientReady, async () => {
    try {
      channel = await client.channels.fetch(config.channelId);
      if (channel?.guildId !== config.guildId || !channel.isSendable()) throw new Error('채널 설정 오류');
      // Recover cards created before persistent message IDs were introduced.
      if (controller.list().length && (!messageIds.size || controller.list().some(r => reviewNoticeKey(r) && !reviewNotices.has(reviewNoticeKey(r))))) {
        const recent = await channel.messages.fetch({ limit: 100 });
        for (const message of recent.values()) {
          recoverNotification(message, client.user.id, messageIds, reviewNotices);
        }
      }
      const command = new SlashCommandBuilder().setName('dolphin-report').setDescription('돌핀데이터 진단 리포트를 관리자에게 전달합니다')
        .addAttachmentOption(o => o.setName('file').setDescription('앱에서 내보낸 진단 JSON').setRequired(true));
      await client.application.commands.create(command, config.guildId);
      await client.application.commands.create(new SlashCommandBuilder().setName('dolphin-batch').setDescription('관리자가 접수 여러 건을 선택해 하나의 수정안으로 처리합니다'), config.guildId);
      status.connected = true;
      for (const record of controller.list().filter(r => !['released', 'interrupted'].includes(r.status))) await publish(record);
    } catch { status.error = '봇 초기 설정 실패: 서버·채널·명령어 권한을 확인해주세요.'; }
  });
  // Publishing is explicitly authorized by starting the configured bot.
  controller.on('change', publish);
  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (interaction.isChatInputCommand() && interaction.commandName === 'dolphin-report') {
        if (interaction.guildId !== config.guildId || interaction.channelId !== config.channelId) {
          await interaction.reply({ content: '지정된 리포트 채널에서 사용해주세요.', flags: MessageFlags.Ephemeral }); return;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const attachment = interaction.options.getAttachment('file', true);
        const url = new URL(attachment.url);
        if (!['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || url.protocol !== 'https:' || attachment.size > MAX_DIAGNOSTIC_BYTES || !attachment.name.endsWith('.json')) throw new Error('진단 JSON 파일만 전달할 수 있습니다.');
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error('리포트 첨부파일을 읽을 수 없습니다.');
        const chunks = []; let length = 0;
        for await (const chunk of response.body) { length += chunk.length; if (length > MAX_DIAGNOSTIC_BYTES) throw new Error('파일 한도를 초과했습니다.'); chunks.push(chunk); }
        const report = await controller.importReport(Buffer.concat(chunks).toString('utf8'));
        await interaction.editReply(`진단 리포트 ${report.id}를 접수했습니다. 설정된 일일 자동 수정 또는 관리자 요청으로 수정안을 준비합니다. 수정·배포는 별도 승인이 필요합니다.`); return;
      }
      if (interaction.isChatInputCommand() && interaction.commandName === 'dolphin-batch') {
        if (!authorizeDiscord(interaction, config)) { await interaction.reply({ content: '지정된 관리자 계정만 일괄 처리를 시작할 수 있습니다.', flags: MessageFlags.Ephemeral }); return; }
        const pending = controller.list().filter(r => r.canRequestFix && r.kind !== 'batch').reverse().slice(0, 25);
        if (pending.length < 2) { await interaction.reply({ content: '함께 처리할 대기 접수가 2건 이상 필요합니다. 검토 중인 수정안에 연결된 접수는 제외됩니다.', flags: MessageFlags.Ephemeral }); return; }
        const menu = new StringSelectMenuBuilder().setCustomId('batch-select').setPlaceholder('함께 수정할 접수 2~10건 선택').setMinValues(2).setMaxValues(Math.min(MAX_BATCH_REPORTS, pending.length))
          .addOptions(pending.map(r => ({ label: `접수 ${r.id.slice(0, 8)} · ${r.report.appVersion}`,
            description: [...redactDescription(r.report.description)].map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /[\u202a-\u202e\u2066-\u2069]/.test(c) ? ' ' : c).join('').slice(0, 100) || `기록 ${r.report.events.length}개 · ${r.report.symptom}`, value: r.id })));
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: '최근 대기 접수 중에서 선택하면 자동 수정이 시작됩니다. 선택한 건들은 하나의 수정안으로 묶고, 수정·배포 승인은 별도로 받습니다. 이전 접수와 전체 설명은 관리자 화면에서 확인해주세요.',
          components: [new ActionRowBuilder().addComponents(menu)] }); return;
      }
      if (interaction.isStringSelectMenu() && interaction.customId === 'batch-select') {
        if (!authorizeDiscord(interaction, config)) { await interaction.reply({ content: '지정된 관리자 계정만 처리할 수 있습니다.', flags: MessageFlags.Ephemeral }); return; }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const batch = await controller.startBatch(interaction.values, `discord:${interaction.user.id}`);
        await interaction.editReply(`접수 ${batch.reportIds.length}건의 일괄 수정 ${batch.id}를 시작했습니다. 결과는 새 일괄 수정 카드에서 확인해주세요.`); return;
      }
      if (!interaction.isButton()) return;
      if (!authorizeDiscord(interaction, config)) { await interaction.reply({ content: '지정된 관리자 계정만 승인할 수 있습니다.', flags: MessageFlags.Ephemeral }); return; }
      const [action, id, expected] = interaction.customId.split(':');
      if (!isId(id)) throw new Error('버튼 형식이 올바르지 않습니다.');
      const record = controller.get(id);
      if (action === 'review' || action === 'release') {
        if (action === 'review' && (record.status !== 'review-ready' || record.candidateSha !== expected)) throw new Error('이전 수정본의 버튼입니다. 최신 결과를 확인해주세요.');
        if (action === 'release' && String(record.releaseRunId) !== expected) throw new Error('이전 배포의 버튼입니다.');
        const confirmation = new ButtonBuilder().setCustomId(`${action === 'review' ? 'approve' : 'publish'}:${id}:${expected}`).setLabel(action === 'review' ? '검토 완료 · 이 수정본 병합' : '승인 · 이 버전 배포').setStyle(ButtonStyle.Danger);
        await interaction.reply({ flags: MessageFlags.Ephemeral, content: action === 'review'
          ? `변경 내용과 검사 설치파일을 확인했으면 승인해주세요. 승인 대상: ${expected}\nmain 코드가 바뀌면 승인은 거절됩니다. 승인 후 GitHub 배포 승인이 한 번 더 필요합니다.`
          : `GitHub 배포 ${expected}, 코드 ${record.releaseSha}를 승인합니다. 서명된 설치파일을 빌드해 사용자 자동 업데이트로 배포합니다.`,
          components: [new ActionRowBuilder().addComponents(confirmation)] }); return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      if (action === 'fix') await controller.startFix(id, `discord:${interaction.user.id}`);
      else if (action === 'retry') {
        await controller.returnToQueue(id, `discord:${interaction.user.id}`, { keepBatch: true });
        await controller.startFix(id, `discord:${interaction.user.id}`);
      }
      else if (action === 'requeue') await controller.returnToQueue(id, `discord:${interaction.user.id}`);
      else if (action === 'approve') await controller.approveCode(id, { sha: expected, patchDigest: record.patchDigest, actor: `discord:${interaction.user.id}` });
      else if (action === 'publish') await controller.approveRelease(id, `discord:${interaction.user.id}`, Number(expected));
      else throw new Error('지원하지 않는 요청입니다.');
      await interaction.editReply('요청을 처리했습니다. 최신 상태는 리포트 카드에서 확인해주세요.');
    } catch (e) {
      const payload = { content: controller.safeError(e), allowedMentions: { parse: [] }, flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });
  const retryTimer = setInterval(() => {
    if (!status.connected) return;
    for (const record of controller.list().filter(r => reviewNoticeKey(r) && !reviewNotices.has(reviewNoticeKey(r)))) publish(record);
  }, 60000);
  try { await client.login(token); }
  catch (error) { clearInterval(retryTimer); controller.off('change', publish); await client.destroy(); throw error; }
  return { status, close: async () => { clearInterval(retryTimer); controller.off('change', publish); await client.destroy(); } };
}
