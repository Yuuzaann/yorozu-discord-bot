import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  UserSelectMenuBuilder,
} from 'discord.js';
import { errorEmbed, successEmbed, primaryEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { configService } from './configService.js';
import { roleService } from './roleService.js';
import { temporaryVoiceService } from './temporaryVoiceService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('VoiceInterface');

export const VOICE_INTERFACE_PREFIX = 'tv:';
const ID = (action) => `${VOICE_INTERFACE_PREFIX}${action}`;
const PANEL_TITLE = 'TempVoice Interface';

/** [action, emoji, label] — laid out exactly as the panel: 3 rows x 5 buttons. */
const GRID = [
  [['name', '✏️', 'NAME'], ['limit', '👥', 'LIMIT'], ['privacy', '🛡️', 'PRIVACY'], ['waiting', '⏳', 'WAITING ROOM'], ['chat', '💬', 'CHAT']],
  [['trust', '🤝', 'TRUST'], ['untrust', '🚷', 'UNTRUST'], ['invite', '📨', 'INVITE'], ['kick', '👢', 'KICK'], ['region', '🌐', 'REGION']],
  [['block', '⛔', 'BLOCK'], ['unblock', '🔓', 'UNBLOCK'], ['claim', '👑', 'CLAIM'], ['transfer', '🔄', 'TRANSFER'], ['delete', '🗑️', 'DELETE']],
];

const REGIONS = [
  ['auto', 'Automatic'], ['brazil', 'Brazil'], ['hongkong', 'Hong Kong'], ['india', 'India'], ['japan', 'Japan'], ['rotterdam', 'Rotterdam'],
  ['russia', 'Russia'], ['singapore', 'Singapore'], ['southafrica', 'South Africa'], ['sydney', 'Sydney'],
  ['us-central', 'US Central'], ['us-east', 'US East'], ['us-south', 'US South'], ['us-west', 'US West'],
];

// Which user-select actions exist and how their result is worded (Indonesian, English).
const USER_ACTIONS = {
  trust: { prompt: ['Pilih member yang dipercaya', 'Pick who to trust'], done: ['Dipercaya', 'Trusted'] },
  untrust: { prompt: ['Pilih member untuk dicabut kepercayaannya', 'Pick who to untrust'], done: ['Kepercayaan dicabut', 'Untrusted'] },
  invite: { prompt: ['Pilih siapa yang diundang', 'Pick who to invite'], done: ['Diundang', 'Invited'] },
  kick: { prompt: ['Pilih member yang dikeluarkan', 'Pick who to kick'], done: ['Dikeluarkan', 'Kicked'] },
  block: { prompt: ['Pilih member yang diblokir', 'Pick who to block'], done: ['Diblokir', 'Blocked'] },
  unblock: { prompt: ['Pilih member untuk dibuka blokirnya', 'Pick who to unblock'], done: ['Blokir dibuka', 'Unblocked'] },
  transfer: { prompt: ['Pilih pemilik baru (harus ada di room)', 'Pick the new owner (must be in the room)'], done: ['Dipindahkan', 'Transferred'] },
};

/** Value for one overwrite flag copied from the room's category — used to undo lock/hide/chat-off exactly. */
function parentFlag(channel, role, bit) {
  const overwrite = channel.parent?.permissionOverwrites.cache.get(role.id);
  if (overwrite?.allow.has(bit)) return true;
  if (overwrite?.deny.has(bit)) return false;
  return null;
}

/** flags: { PermissionName: true | false | null | 'restore' } — 'restore' = whatever the category says. */
function applyFlags(channel, roles, flags) {
  return Promise.all(
    roles.map((role) => {
      const perms = {};
      for (const [name, value] of Object.entries(flags)) {
        perms[name] = value === 'restore' ? parentFlag(channel, role, PermissionFlagsBits[name]) : value;
      }
      return channel.permissionOverwrites.edit(role, perms);
    })
  );
}

const usesUpdate = (interaction) => interaction.isStringSelectMenu() || interaction.isUserSelectMenu();

class VoiceInterfaceService {
  buildPanel() {
    const legend = GRID.map((row) => row.map(([, emoji, label]) => `\`${emoji} ${label}\``).join(' ')).join('\n');
    const embed = new EmbedBuilder()
      .setColor(0xe0314b)
      .setTitle(PANEL_TITLE)
      .setDescription(
        [
          '🇮🇩 **Interface** ini dipakai untuk mengatur voice sementara milikmu. Opsi lain tersedia lewat command `/voice`.',
          '🇬🇧 This **interface** can be used to manage temporary voice channels. More options are available with `/voice` commands.',
          '',
          legend,
          '',
          'Tekan tombol di bawah / Press the buttons below to use the interface',
        ].join('\n')
      );
    const components = GRID.map((row) =>
      new ActionRowBuilder().addComponents(
        row.map(([action, emoji]) => new ButtonBuilder().setCustomId(ID(action)).setEmoji(emoji).setStyle(ButtonStyle.Secondary))
      )
    );
    return { embeds: [embed], components };
  }

  /** Posts the panel, or refreshes the existing one in that channel (so re-running setup never duplicates it). */
  async ensurePanel(channel) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages?.find((m) => m.author.id === channel.client.user.id && m.embeds?.[0]?.title === PANEL_TITLE);
    if (existing) {
      await existing.edit(this.buildPanel()).catch(() => {});
      return existing;
    }
    return channel.send(this.buildPanel());
  }

  // ---------------------------------------------------------------- helpers

  _send(interaction, embed, extra = {}) {
    if (usesUpdate(interaction)) return interaction.update({ embeds: [embed], components: [], ...extra });
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, ...extra });
  }

  _error(interaction, idTitle, enTitle, idText, enText) {
    return this._send(interaction, errorEmbed(biTitle(idTitle, enTitle), bi(idText, enText)));
  }

  /** The member's temp room (+ owner info). Replies with an error and returns null if they aren't in one / aren't the owner. */
  async _context(interaction, { ownerOnly = true } = {}) {
    const channel = interaction.member?.voice?.channel ?? null;
    if (!channel || !temporaryVoiceService.isManaged(channel.id)) {
      await this._error(interaction, 'Bukan room sementara', 'No temporary room', 'Kamu harus berada di room voice sementara untuk memakai interface ini.', 'You must be in a temporary voice room to use this interface.');
      return null;
    }
    const ownerId = temporaryVoiceService.getOwner(channel.id);
    const isOwner = ownerId === interaction.user.id;
    if (ownerOnly && !isOwner) {
      await this._error(interaction, 'Bukan pemilik', 'Not the owner', 'Hanya pemilik room yang bisa melakukan ini. Tekan 👑 CLAIM kalau pemiliknya sudah keluar.', 'Only the room owner can do this. Press 👑 CLAIM if the owner has left.');
      return null;
    }
    return { channel, ownerId, isOwner, guild: interaction.guild };
  }

  /** @everyone + Verified + Member: the roles that normally let people see/join a room. Overriding only @everyone would not hide a room from Verified. */
  async _gatedRoles(guild) {
    const config = await configService.getGuildConfig(guild.id);
    const roles = [guild.roles.everyone];
    const verified = roleService.findByLabel(guild, config.verification.roleName);
    if (verified) roles.push(verified);
    const member = config.roles.member.enabled ? roleService.findByLabel(guild, config.roles.member.name) : null;
    if (member) roles.push(member);
    return roles;
  }

  // ---------------------------------------------------------------- routing

  async handle(interaction) {
    const action = interaction.customId.slice(VOICE_INTERFACE_PREFIX.length);

    if (interaction.isButton()) {
      if (action === 'delete_confirm') return this._deleteConfirm(interaction);
      if (action === 'delete_cancel') {
        return interaction.update({ embeds: [successEmbed(biTitle('Dibatalkan', 'Cancelled'), bi('Room tidak dihapus.', 'The room was not deleted.'))], components: [] });
      }
      return this._onButton(interaction, action);
    }
    if (interaction.isModalSubmit()) return this._onModal(interaction, action);
    if (interaction.isStringSelectMenu()) return this._onStringSelect(interaction, action);
    if (interaction.isUserSelectMenu()) return this._onUserSelect(interaction, action.replace(/_select$/, ''));
  }

  async _onButton(interaction, action) {
    const ctx = await this._context(interaction, { ownerOnly: action !== 'claim' });
    if (!ctx) return;
    const { channel, ownerId, guild } = ctx;

    switch (action) {
      case 'name': {
        const input = new TextInputBuilder()
          .setCustomId('value')
          .setLabel('Nama baru / New name')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(95)
          .setRequired(true)
          .setValue(channel.name.replace(/^🔊・/, '').slice(0, 95));
        return interaction.showModal(new ModalBuilder().setCustomId(ID('name_modal')).setTitle('Ganti nama / Rename room').addComponents(new ActionRowBuilder().addComponents(input)));
      }
      case 'limit': {
        const input = new TextInputBuilder()
          .setCustomId('value')
          .setLabel('Batas member 0-99 (0 = tanpa batas) / Limit')
          .setStyle(TextInputStyle.Short)
          .setMinLength(1)
          .setMaxLength(2)
          .setRequired(true)
          .setValue(String(channel.userLimit || 0));
        return interaction.showModal(new ModalBuilder().setCustomId(ID('limit_modal')).setTitle('Batas member / User limit').addComponents(new ActionRowBuilder().addComponents(input)));
      }
      case 'privacy': {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(ID('privacy_select'))
          .setPlaceholder('Privasi room / Room privacy')
          .addOptions(
            { label: 'Public', value: 'public', emoji: '🔓', description: 'Semua orang bisa lihat & masuk / Everyone can see and join' },
            { label: 'Locked', value: 'locked', emoji: '🔒', description: 'Terlihat tapi tidak bisa masuk / Visible, but nobody can join' },
            { label: 'Hidden', value: 'hidden', emoji: '🙈', description: 'Tersembunyi dari semua orang / Hidden from everyone' }
          );
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
      }
      case 'region': {
        const menu = new StringSelectMenuBuilder()
          .setCustomId(ID('region_select'))
          .setPlaceholder('Region voice / Voice region')
          .addOptions(REGIONS.map(([value, label]) => ({ label, value })));
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
      }
      case 'chat':
        return this._toggleChat(interaction, ctx);
      case 'waiting':
        return this._toggleWaiting(interaction, ctx);
      case 'claim':
        return this._claim(interaction, ctx);
      case 'delete': {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(ID('delete_confirm')).setLabel('Ya, hapus / Yes, delete').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(ID('delete_cancel')).setLabel('Batal / Cancel').setStyle(ButtonStyle.Secondary)
        );
        return interaction.reply({
          embeds: [errorEmbed(biTitle('Hapus room?', 'Delete room?'), bi('Room ini akan dihapus dan semua orang di dalamnya keluar.', 'This room will be deleted and everyone inside is disconnected.'))],
          components: [row],
          flags: MessageFlags.Ephemeral,
        });
      }
      default: {
        const spec = USER_ACTIONS[action];
        if (!spec) return;
        const menu = new UserSelectMenuBuilder()
          .setCustomId(ID(`${action}_select`))
          .setPlaceholder(`${spec.prompt[0]} / ${spec.prompt[1]}`)
          .setMinValues(1)
          .setMaxValues(action === 'transfer' ? 1 : 5);
        return interaction.reply({ components: [new ActionRowBuilder().addComponents(menu)], flags: MessageFlags.Ephemeral });
      }
    }
  }

  // ---------------------------------------------------------------- modals

  async _onModal(interaction, action) {
    const ctx = await this._context(interaction);
    if (!ctx) return;
    const { channel } = ctx;
    const raw = interaction.fields.getTextInputValue('value').trim();

    if (action === 'name_modal') {
      // Renames are rate-limited (2 per 10 min) and can stall well past 3 seconds — defer first.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const value = raw.slice(0, 95);
      await channel.setName(`🔊・${value}`);
      await interaction.editReply({ embeds: [successEmbed(biTitle('Diganti nama', 'Renamed'), `Room diganti nama jadi / Room renamed to 🔊・${value}`)] });
      return;
    }

    if (action === 'limit_modal') {
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0 || value > 99) {
        return this._error(interaction, 'Angka tidak valid', 'Invalid number', 'Masukkan angka bulat 0-99.', 'Enter a whole number from 0 to 99.');
      }
      await channel.setUserLimit(value);
      return this._send(
        interaction,
        successEmbed(biTitle('Limit diatur', 'Limit set'), `Batas user diatur ke / User limit set to ${value === 0 ? 'tanpa batas / unlimited' : value}`)
      );
    }
  }

  // ---------------------------------------------------------------- string selects

  async _onStringSelect(interaction, action) {
    const ctx = await this._context(interaction);
    if (!ctx) return;
    const { channel, guild } = ctx;
    const value = interaction.values[0];

    if (action === 'privacy_select') {
      const roles = await this._gatedRoles(guild);
      if (value === 'public') await applyFlags(channel, roles, { ViewChannel: 'restore', Connect: 'restore' });
      else if (value === 'locked') await applyFlags(channel, roles, { ViewChannel: 'restore', Connect: false });
      else if (value === 'hidden') await applyFlags(channel, roles, { ViewChannel: false, Connect: false });
      else return;
      const label = { public: '🔓 Public', locked: '🔒 Locked', hidden: '🙈 Hidden' }[value];
      return this._send(interaction, successEmbed(biTitle('Privasi diatur', 'Privacy set'), `${bi('Room sekarang', 'Room is now')} **${label}**`));
    }

    if (action === 'region_select') {
      const region = value === 'auto' ? null : value;
      await channel.setRTCRegion(region);
      const label = REGIONS.find(([id]) => id === value)?.[1] ?? value;
      return this._send(interaction, successEmbed(biTitle('Region diatur', 'Region set'), `🌐 ${label}`));
    }
  }

  // ---------------------------------------------------------------- user selects

  async _onUserSelect(interaction, action) {
    const spec = USER_ACTIONS[action];
    if (!spec) return;
    const ctx = await this._context(interaction);
    if (!ctx) return;
    const { channel, ownerId, guild } = ctx;

    if (action === 'transfer') return this._transfer(interaction, ctx);

    const ids = interaction.values.filter((id) => id !== interaction.user.id && id !== ownerId);
    if (ids.length === 0) {
      return this._error(interaction, 'Pilihan tidak valid', 'Invalid choice', 'Pilih member lain, bukan dirimu sendiri.', 'Pick someone other than yourself.');
    }

    const done = [];
    const skipped = [];
    for (const id of ids) {
      const member = await guild.members.fetch(id).catch(() => null);
      const inRoom = member?.voice?.channelId === channel.id;
      const overwrite = channel.permissionOverwrites.cache.get(id);

      switch (action) {
        case 'trust':
          await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true });
          done.push(id);
          break;
        case 'untrust':
          if (overwrite?.allow.has(PermissionFlagsBits.Connect)) {
            await channel.permissionOverwrites.delete(id, 'TempVoice: untrust');
            done.push(id);
          } else skipped.push(id);
          break;
        case 'invite': {
          await channel.permissionOverwrites.edit(id, { ViewChannel: true, Connect: true });
          const dm = member
            ? await member
                .send({
                  embeds: [
                    primaryEmbed(
                      biTitle('📨 Undangan voice', 'Voice invite'),
                      `${bi(`<@${interaction.user.id}> mengundangmu ke room voice.`, `<@${interaction.user.id}> invited you to a voice room.`)}\n\nhttps://discord.com/channels/${guild.id}/${channel.id}`
                    ),
                  ],
                })
                .then(() => true)
                .catch(() => false)
            : false;
          (dm ? done : skipped).push(id);
          break;
        }
        case 'kick':
          if (inRoom) {
            await member.voice.disconnect('Kicked via TempVoice interface');
            done.push(id);
          } else skipped.push(id);
          break;
        case 'block':
          await channel.permissionOverwrites.edit(id, { ViewChannel: false, Connect: false });
          if (inRoom) await member.voice.disconnect('Blocked via TempVoice interface').catch(() => {});
          done.push(id);
          break;
        case 'unblock':
          if (overwrite?.deny.has(PermissionFlagsBits.Connect)) {
            await channel.permissionOverwrites.delete(id, 'TempVoice: unblock');
            done.push(id);
          } else skipped.push(id);
          break;
        default:
          break;
      }
    }

    const mention = (list) => list.map((id) => `<@${id}>`).join(', ');
    const lines = [];
    if (done.length > 0) lines.push(`✅ ${spec.done[0]} / ${spec.done[1]}: ${mention(done)}`);
    if (skipped.length > 0) {
      const why = {
        untrust: ['tidak sedang dipercaya', 'was not trusted'],
        invite: ['DM tidak terkirim (izin masuk tetap diberikan)', 'DM failed (access was still granted)'],
        kick: ['tidak ada di room', 'not in the room'],
        unblock: ['tidak sedang diblokir', 'was not blocked'],
      }[action] ?? ['dilewati', 'skipped'];
      lines.push(`⚠️ ${why[0]} / ${why[1]}: ${mention(skipped)}`);
    }
    const embed = done.length > 0 ? successEmbed : errorEmbed;
    return this._send(interaction, embed(biTitle(spec.done[0], spec.done[1]), lines.join('\n')));
  }

  // ---------------------------------------------------------------- single actions

  async _transfer(interaction, { channel, ownerId, guild }) {
    const targetId = interaction.values[0];
    const target = await guild.members.fetch(targetId).catch(() => null);
    if (!target || target.user.bot || targetId === ownerId || target.voice?.channelId !== channel.id) {
      return this._error(interaction, 'Tidak bisa dipindahkan', 'Cannot transfer', 'Pemilik baru harus manusia lain yang sedang ada di room ini.', 'The new owner must be another human who is currently in this room.');
    }
    await temporaryVoiceService.transferOwnership(channel.id, targetId);
    await channel.permissionOverwrites.delete(ownerId, 'Room ownership transferred').catch(() => {});
    await channel.permissionOverwrites.edit(targetId, { ManageChannels: true, MoveMembers: true, ViewChannel: true, Connect: true });
    const waitingId = temporaryVoiceService.getWaiting(channel.id);
    const waiting = waitingId ? guild.channels.cache.get(waitingId) : null;
    if (waiting) {
      await waiting.permissionOverwrites.delete(ownerId).catch(() => {});
      await waiting.permissionOverwrites.edit(targetId, { MoveMembers: true, ViewChannel: true, Connect: true }).catch(() => {});
    }
    return this._send(interaction, successEmbed(biTitle('Dipindahkan', 'Transferred'), bi(`<@${targetId}> sekarang pemilik room ini.`, `<@${targetId}> is now the owner of this room.`)));
  }

  async _claim(interaction, { channel, ownerId, guild }) {
    if (ownerId === interaction.user.id) {
      return this._error(interaction, 'Sudah pemilik', 'Already the owner', 'Kamu sudah pemilik room ini.', 'You already own this room.');
    }
    if (ownerId && channel.members.has(ownerId)) {
      return this._error(interaction, 'Room masih ada pemiliknya', 'Room has an owner', 'Pemilik saat ini masih ada di dalam room.', 'The current owner is still in the room.');
    }
    await temporaryVoiceService.transferOwnership(channel.id, interaction.user.id);
    // The previous owner must lose their management rights, otherwise they keep control of a room they no longer own.
    if (ownerId) await channel.permissionOverwrites.delete(ownerId, 'Room ownership transferred').catch(() => {});
    await channel.permissionOverwrites.edit(interaction.user.id, { ManageChannels: true, MoveMembers: true, ViewChannel: true, Connect: true });
    return this._send(interaction, successEmbed(biTitle('Room diklaim', 'Room claimed'), bi('Kamu sekarang pemilik room ini.', 'You are now the owner of this room.')));
  }

  async _toggleChat(interaction, { channel, ownerId, guild }) {
    const roles = await this._gatedRoles(guild);
    const chatOn = !channel.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.SendMessages);
    if (chatOn) {
      await applyFlags(channel, roles, { SendMessages: false });
      await channel.permissionOverwrites.edit(ownerId, { SendMessages: true });
    } else {
      await applyFlags(channel, roles, { SendMessages: 'restore' });
      await channel.permissionOverwrites.edit(ownerId, { SendMessages: null });
    }
    return this._send(
      interaction,
      successEmbed(
        biTitle('Chat diatur', 'Chat updated'),
        chatOn ? bi('💬 Chat room dimatikan (hanya kamu yang bisa menulis).', '💬 Room chat is off (only you can write).') : bi('💬 Chat room dinyalakan.', '💬 Room chat is on.')
      )
    );
  }

  async _toggleWaiting(interaction, { channel, ownerId, guild }) {
    const existingId = temporaryVoiceService.getWaiting(channel.id);
    if (existingId) {
      await guild.channels.delete(existingId, 'TempVoice: waiting room removed').catch(() => {});
      await temporaryVoiceService.setWaiting(channel.id, null);
      return this._send(interaction, successEmbed(biTitle('Waiting room dihapus', 'Waiting room removed'), '⏳'));
    }

    // Same visibility as the room's category (so it is as joinable as any other room there); the owner may move people out of it.
    const source = channel.parent?.permissionOverwrites?.cache ?? channel.permissionOverwrites.cache;
    const inherited = [...source.values()]
      .filter((o) => o.id !== ownerId)
      .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }));
    const waiting = await guild.channels.create({
      name: '⏳・Waiting Room',
      type: ChannelType.GuildVoice,
      parent: channel.parentId ?? undefined,
      permissionOverwrites: [...inherited, { id: ownerId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.MoveMembers] }],
      reason: 'TempVoice: waiting room',
    });
    await temporaryVoiceService.setWaiting(channel.id, waiting.id);
    return this._send(
      interaction,
      successEmbed(biTitle('Waiting room dibuat', 'Waiting room created'), bi(`⏳ <#${waiting.id}> dibuat. Tarik member dari sana ke room kamu.`, `⏳ <#${waiting.id}> created. Drag members from there into your room.`))
    );
  }

  async _deleteConfirm(interaction) {
    const ctx = await this._context(interaction);
    if (!ctx) return;
    await interaction.update({ embeds: [successEmbed(biTitle('Room dihapus', 'Room deleted'), '🗑️')], components: [] });
    await temporaryVoiceService.removeRoom(ctx.channel, 'Deleted by owner via TempVoice interface').catch((err) => logger.warn('Failed to delete room', err.message));
  }
}

export const voiceInterfaceService = new VoiceInterfaceService();
