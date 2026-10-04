import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { primaryEmbed, successEmbed, errorEmbed, warningEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { toChannelSafeName } from '../utils/normalize.js';
import { configService } from './configService.js';
import { loggingService } from './loggingService.js';
import { roleService } from './roleService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TicketService');

export const TICKET_CATEGORY_SELECT_ID = 'ticket_category';
export const TICKET_CLOSE_ID = 'ticket_close';
export const TICKET_CLAIM_ID = 'ticket_claim';
export const TICKET_DELETE_ID = 'ticket_delete';
export const TICKET_REOPEN_ID = 'ticket_reopen';
export const TICKET_DELETE_CONFIRM_ID = 'ticket_delete_confirm';
export const TICKET_DELETE_CANCEL_ID = 'ticket_delete_cancel';

class TicketService {
  constructor() {
    // userIds currently in the middle of creating a ticket (blocks double-click races).
    this.creating = new Set();
  }

  buildPanel(config) {
    const embed = primaryEmbed(
      biTitle('🎟️ Support Ticket', 'Support Ticket'),
      bi('Butuh bantuan? Pilih kategori ticket.', 'Need help? Pick a ticket category.')
    );
    const menu = new StringSelectMenuBuilder()
      .setCustomId(TICKET_CATEGORY_SELECT_ID)
      .setPlaceholder('Pilih kategori / Pick a category')
      .addOptions(
        config.ticket.categories.map((c) => ({ label: c.label, value: c.id, emoji: c.emoji }))
      );
    const row = new ActionRowBuilder().addComponents(menu);
    return { embeds: [embed], components: [row] };
  }

  async ensurePanel(channel, config) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages?.find(
      (m) => m.author.id === channel.client.user.id && m.components?.[0]?.components?.[0]?.customId === TICKET_CATEGORY_SELECT_ID
    );
    if (existing) {
      // Keep the menu in sync with the current config (categories may have changed).
      await existing.edit(this.buildPanel(config)).catch(() => {});
      return existing;
    }
    return channel.send(this.buildPanel(config));
  }

  _controlsRow(claimed) {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(TICKET_CLOSE_ID).setLabel('Tutup / Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(TICKET_CLAIM_ID)
        .setLabel(claimed ? 'Diklaim / Claimed' : 'Klaim / Claim')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(Boolean(claimed)),
      new ButtonBuilder().setCustomId(TICKET_DELETE_ID).setLabel('Hapus / Delete').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
    );
  }

  _closedControlsRow() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(TICKET_REOPEN_ID).setLabel('Buka Lagi / Reopen').setEmoji('🔓').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(TICKET_DELETE_ID).setLabel('Hapus / Delete').setEmoji('🗑️').setStyle(ButtonStyle.Secondary)
    );
  }

  _confirmRow() {
    return new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(TICKET_DELETE_CONFIRM_ID).setLabel('Ya / Confirm').setEmoji('🔴').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(TICKET_DELETE_CANCEL_ID).setLabel('Batal / Cancel').setEmoji('⚪').setStyle(ButtonStyle.Secondary)
    );
  }

  /** The configured staff role, falling back to the "Staff" role that /setup server creates. */
  _getStaffRole(guild, config) {
    if (config.ticket.staffRoleId) {
      const configured = guild.roles.cache.get(config.ticket.staffRoleId);
      if (configured) return configured;
    }
    return roleService.findByLabel(guild, config.setup?.staffRoleName ?? 'Staff');
  }

  _isStaff(member, guild, config) {
    const role = this._getStaffRole(guild, config);
    return Boolean(role && member.roles.cache.has(role.id));
  }

  async handleCategorySelect(interaction, config) {
    if (config.ticket.enabled === false) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Dinonaktifkan', 'Disabled'), bi('Sistem ticket dinonaktifkan untuk server ini.', 'The ticket system is disabled for this server.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Channel creation can easily take longer than Discord's 3-second reply window.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (this.creating.has(interaction.user.id)) {
      await interaction.editReply({
        embeds: [warningEmbed(biTitle('Mohon tunggu', 'Please wait'), bi('Ticket kamu sedang dibuat.', 'Your ticket is already being created.'))],
      });
      return;
    }
    this.creating.add(interaction.user.id);
    try {
      await this._createTicket(interaction, config);
    } finally {
      this.creating.delete(interaction.user.id);
    }
  }

  async _createTicket(interaction, config) {
    const guild = interaction.guild;
    const categoryId = interaction.values[0];
    const category = config.ticket.categories.find((c) => c.id === categoryId);
    const tickets = await configService.getTickets(guild.id);

    // Count only tickets whose channel still exists — a ticket channel deleted by hand
    // must not lock the member out of ever opening a new ticket.
    const openForUser = [];
    for (const [channelId, t] of Object.entries(tickets)) {
      if (t.ownerId !== interaction.user.id || t.status !== 'open') continue;
      if (!guild.channels.cache.has(channelId)) {
        await configService.deleteTicket(guild.id, channelId);
        continue;
      }
      openForUser.push(t);
    }
    if (openForUser.length >= config.ticket.maxTicketsPerUser) {
      await interaction.editReply({
        embeds: [errorEmbed(biTitle('Ticket aktif', 'Active ticket'), bi('❌ Kamu masih memiliki ticket aktif.', '❌ You already have an active ticket.'))],
      });
      return;
    }

    const supportCategory = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === '🎟️ ┊ SUPPORT');
    const staffRole = this._getStaffRole(guild, config);

    const overwrites = [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: interaction.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ];
    if (staffRole) {
      overwrites.push({
        id: staffRole.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.EmbedLinks,
        ],
      });
    }

    const channelName = toChannelSafeName(`${categoryId}-${interaction.user.username}`, 'ticket');
    let ticketChannel;
    try {
      ticketChannel = await guild.channels.create({
        name: `🎫・${channelName}`,
        type: ChannelType.GuildText,
        parent: supportCategory?.id,
        permissionOverwrites: overwrites,
        reason: `Ticket created by ${interaction.user.tag}`,
      });
    } catch (err) {
      logger.error('Failed to create ticket channel', err.message);
      await interaction.editReply({
        embeds: [errorEmbed(biTitle('Gagal', 'Failed'), bi('Tidak dapat membuat channel ticket.', 'Could not create the ticket channel.'))],
      });
      return;
    }

    const record = {
      ownerId: interaction.user.id,
      category: category?.label ?? categoryId,
      channelName,
      status: 'open',
      claimedBy: null,
      createdAt: Date.now(),
    };
    await configService.setTicket(guild.id, ticketChannel.id, record);

    const embed = primaryEmbed(biTitle('🎟️ Support Ticket', 'Support Ticket'), null).addFields(
      { name: 'User', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Kategori / Category', value: record.category, inline: true }
    );
    await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [this._controlsRow(false)] });
    await interaction.editReply({
      embeds: [successEmbed(biTitle('Ticket dibuat', 'Ticket created'), `Ticket kamu / Your ticket: <#${ticketChannel.id}>`)],
    });
    await loggingService.logAction(guild, 'Ticket Dibuat / Ticket Created', `${interaction.user.tag} opened ${record.category}`, {
      channel: ticketChannel.id,
    });
  }

  /**
   * Shared gate for every ticket button/command: the channel must be a tracked
   * ticket, and the user must be allowed to act on it (owner/staff/admin, or
   * staff/admin only when `staffOnly`). Replies with the reason and returns
   * null when the action must not proceed.
   */
  async _authorize(interaction, { staffOnly = false } = {}) {
    const guild = interaction.guild;
    const record = (await configService.getTickets(guild.id))[interaction.channel.id];
    if (!record) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Bukan ticket', 'Not a ticket'), bi('Channel ini bukan ticket aktif.', 'This channel is not an active ticket.'))],
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }

    const config = await configService.getGuildConfig(guild.id);
    const isAdminUser = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const allowed = staffOnly ? isAdminUser || this._isStaff(interaction.member, guild, config) : await this.canManage(interaction, config, record);
    if (!allowed) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Akses ditolak', 'Access denied'),
            staffOnly
              ? bi('Hanya staff atau admin yang dapat melakukan ini.', 'Only staff or an admin can do this.')
              : bi('Hanya owner, staff, atau admin yang dapat melakukan ini.', 'Only the owner, staff, or an admin can do this.')
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return null;
    }
    return { record, config };
  }

  async handleClose(interaction) {
    const auth = await this._authorize(interaction);
    if (!auth) return;
    const { record } = auth;
    const guild = interaction.guild;
    const channel = interaction.channel;

    if (record.status === 'closed') {
      await interaction.reply({
        embeds: [warningEmbed(biTitle('Sudah ditutup', 'Already closed'), bi('Ticket ini sudah ditutup.', 'This ticket is already closed.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    record.status = 'closed';
    await configService.setTicket(guild.id, channel.id, record);

    // Reply first: renaming a channel is limited to 2 per 10 minutes and can stall far past the 3-second reply window.
    await interaction.reply({
      embeds: [warningEmbed(biTitle('Ticket ditutup', 'Ticket closed'), bi('Ticket telah ditutup.', 'This ticket has been closed.'))],
      components: [this._closedControlsRow()],
    });
    await channel.permissionOverwrites.edit(record.ownerId, { SendMessages: false }).catch(() => {});
    channel.setName(`🔒・${record.channelName ?? 'closed'}`).catch(() => {});
    await loggingService.logAction(guild, 'Ticket Ditutup / Ticket Closed', `${interaction.user.tag} closed ticket`, { channel: channel.id });
  }

  async handleReopen(interaction) {
    const auth = await this._authorize(interaction);
    if (!auth) return;
    const { record } = auth;
    const guild = interaction.guild;
    const channel = interaction.channel;

    if (record.status === 'open') {
      await interaction.reply({
        embeds: [warningEmbed(biTitle('Sudah terbuka', 'Already open'), bi('Ticket ini masih terbuka.', 'This ticket is already open.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    record.status = 'open';
    await configService.setTicket(guild.id, channel.id, record);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Ticket dibuka kembali', 'Ticket reopened'), bi('Ticket telah dibuka kembali.', 'This ticket has been reopened.'))],
      components: [this._controlsRow(Boolean(record.claimedBy))],
    });
    await channel.permissionOverwrites.edit(record.ownerId, { SendMessages: true }).catch(() => {});
    channel.setName(`🎫・${record.channelName ?? 'ticket'}`).catch(() => {});
    await loggingService.logAction(guild, 'Ticket Dibuka Lagi / Ticket Reopened', `${interaction.user.tag} reopened ticket`, { channel: channel.id });
  }

  async handleClaim(interaction) {
    // Claiming is a staff action — the ticket owner can't claim their own ticket.
    const auth = await this._authorize(interaction, { staffOnly: true });
    if (!auth) return;
    const { record } = auth;
    const guild = interaction.guild;
    const channel = interaction.channel;

    if (record.claimedBy) {
      await interaction.reply({
        embeds: [warningEmbed(biTitle('Sudah diklaim', 'Already claimed'), bi(`Ticket ini sudah diklaim oleh <@${record.claimedBy}>.`, `This ticket has already been claimed by <@${record.claimedBy}>.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    record.claimedBy = interaction.user.id;
    await configService.setTicket(guild.id, channel.id, record);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Ticket diklaim', 'Ticket claimed'), `Diklaim oleh / Claimed by <@${interaction.user.id}>.`)],
      components: [this._controlsRow(true)],
    });
    await loggingService.logAction(guild, 'Ticket Diklaim / Ticket Claimed', `${interaction.user.tag} claimed ticket`, { channel: channel.id });
  }

  async handleDeleteRequest(interaction) {
    const auth = await this._authorize(interaction);
    if (!auth) return;
    await interaction.reply({
      embeds: [
        warningEmbed(
          '🔴 Hapus Ticket / Delete Ticket',
          bi('Ticket ini akan dihapus permanen. Lanjutkan?', 'This ticket will be permanently deleted. Continue?')
        ),
      ],
      components: [this._confirmRow()],
      flags: MessageFlags.Ephemeral,
    });
  }

  async handleDeleteConfirm(interaction) {
    // Re-check on confirm: this must only ever delete a tracked ticket channel, never an arbitrary channel.
    const auth = await this._authorize(interaction);
    if (!auth) return;
    const guild = interaction.guild;
    const channel = interaction.channel;
    await interaction.update({ content: 'Menghapus ticket... / Deleting ticket...', embeds: [], components: [] });
    await loggingService.logAction(guild, 'Ticket Dihapus / Ticket Deleted', `${interaction.user.tag} deleted ticket`, { channel: channel.id });
    await configService.deleteTicket(guild.id, channel.id);
    await channel.delete('Ticket deleted').catch((err) => logger.error('Failed to delete ticket channel', err.message));
  }

  async handleDeleteCancel(interaction) {
    await interaction.update({
      embeds: [primaryEmbed(biTitle('Dibatalkan', 'Cancelled'), bi('Penghapusan ticket dibatalkan.', 'Ticket deletion cancelled.'))],
      components: [],
    });
  }

  /** Checks whether the interacting user may act on a ticket (owner/staff/admin). */
  async canManage(interaction, config, record) {
    if (interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    if (record.ownerId === interaction.user.id) return true;
    return this._isStaff(interaction.member, interaction.guild, config);
  }

  /** Builds a plain-text transcript (no attachments content, only names) for a ticket channel. */
  async buildTranscript(channel) {
    const messages = [];
    let lastId;
    for (let i = 0; i < 10; i += 1) {
      const batch = await channel.messages.fetch({ limit: 100, before: lastId });
      if (batch.size === 0) break;
      messages.push(...batch.values());
      lastId = batch.last().id;
      if (batch.size < 100) break;
    }
    messages.reverse();
    const lines = messages.map((m) => {
      const attachments = m.attachments.map((a) => a.name).join(', ');
      const time = new Date(m.createdTimestamp).toISOString();
      return `[${time}] ${m.author.tag}: ${m.content}${attachments ? ` (attachments: ${attachments})` : ''}`;
    });
    return lines.join('\n');
  }
}

export const ticketService = new TicketService();
