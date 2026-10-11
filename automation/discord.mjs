import { Client, GatewayIntentBits, Events, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { authorizeDiscord, isId } from './policy.mjs';
import { MAX_DIAGNOSTIC_BYTES } from '../src/services/diagnosticService.js';
import { discordCard } from './discordCards.mjs';

export async function startDiscord(controller, config, token) {
  if (!token || !config.guildId || !config.channelId || !config.ownerId) return null;
  if (![config.guildId, config.channelId, config.ownerId].every(v => /^\d{17,22}$/.test(v))) throw new Error('디스코드 ID 형식이 올바르지 않습니다.');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  const status = { connected: false, error: '' };
  const messageIds = new Map();
  let channel;
  const publish = async record => {
    if (!channel) return;
    try {
      const card = discordCard(record);
      const existing = messageIds.get(record.id);
      if (existing) await channel.messages.edit(existing, card);
      else { const message = await channel.send(card); messageIds.set(record.id, message.id); }
    } catch { status.error = '디스코드 카드 전송 실패: 채널 권한·연결을 확인해주세요.'; }
  };
  client.on(Events.Error, () => { status.error = '디스코드 연결 오류'; });
  client.once(Events.ClientReady, async () => {
    try {
      channel = await client.channels.fetch(config.channelId);
      if (channel?.guildId !== config.guildId || !channel.isSendable()) throw new Error('채널 설정 오류');
      const command = new SlashCommandBuilder().setName('dolphin-report').setDescription('돌핀데이터 진단 리포트를 관리자에게 전달합니다')
        .addAttachmentOption(o => o.setName('file').setDescription('앱에서 내보낸 진단 JSON').setRequired(true));
      await client.application.commands.create(command, config.guildId);
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
        await interaction.editReply(`진단 리포트 ${report.id}를 접수했습니다. 자동 수정은 관리자 승인 후 실행됩니다.`); return;
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
  await client.login(token);
  return { status, close: async () => { controller.off('change', publish); await client.destroy(); } };
}
