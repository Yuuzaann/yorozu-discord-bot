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
    if (existing) return existing;
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

  async handleCategorySelect(interaction, config) {
    const guild = interaction.guild;
    const categoryId = interaction.values[0];
    const category = config.ticket.categories.find((c) => c.id === categoryId);
    const tickets = await configService.getTickets(guild.id);

    const openForUser = Object.values(tickets).filter(
      (t) => t.ownerId === interaction.user.id && t.status === 'open'
    );
    if (openForUser.length >= config.ticket.maxTicketsPerUser) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Ticket aktif', 'Active ticket'), bi('❌ Kamu masih memiliki ticket aktif.', "❌ You already have an active ticket."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const supportCategory = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name === '🎟️ Support');
    const staffRole = config.ticket.staffRoleId ? guild.roles.cache.get(config.ticket.staffRoleId) : null;

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
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Gagal', 'Failed'), bi('Tidak dapat membuat channel ticket.', 'Could not create the ticket channel.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const record = {
      ownerId: interaction.user.id,
      category: category?.label ?? categoryId,
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
    await interaction.reply({
      embeds: [successEmbed(biTitle('Ticket dibuat', 'Ticket created'), `Ticket kamu / Your ticket: <#${ticketChannel.id}>`)],
      flags: MessageFlags.Ephemeral,
    });
    await loggingService.logAction(guild, 'Ticket Dibuat / Ticket Created', `${interaction.user.tag} opened ${record.category}`, {
      channel: ticketChannel.id,
    });
  }

  async handleClose(interaction) {
    const guild = interaction.guild;
    const channel = interaction.channel;
    const tickets = await configService.getTickets(guild.id);
    const record = tickets[channel.id];
    if (!record) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Bukan ticket', 'Not a ticket'), bi('Channel ini bukan ticket aktif.', 'This channel is not an active ticket.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    record.status = 'closed';
    await configService.setTicket(guild.id, channel.id, record);
    await channel.permissionOverwrites.edit(record.ownerId, { SendMessages: false }).catch(() => {});
    const safeName = toChannelSafeName(`closed-${interaction.user.username}`, 'closed');
    await channel.setName(`🔒・${safeName}`).catch(() => {});
    await interaction.reply({
      embeds: [warningEmbed(biTitle('Ticket ditutup', 'Ticket closed'), bi('Ticket telah ditutup.', 'This ticket has been closed.'))],
      components: [this._closedControlsRow()],
    });
    await loggingService.logAction(guild, 'Ticket Ditutup / Ticket Closed', `${interaction.user.tag} closed ticket`, { channel: channel.id });
  }

  async handleReopen(interaction) {
    const guild = interaction.guild;
    const channel = interaction.channel;
    const tickets = await configService.getTickets(guild.id);
    const record = tickets[channel.id];
    if (!record) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Bukan ticket', 'Not a ticket'), bi('Channel ini bukan ticket aktif.', 'This channel is not an active ticket.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    record.status = 'open';
    await configService.setTicket(guild.id, channel.id, record);
    await channel.permissionOverwrites.edit(record.ownerId, { SendMessages: true }).catch(() => {});
    await interaction.reply({
      embeds: [successEmbed(biTitle('Ticket dibuka kembali', 'Ticket reopened'), bi('Ticket telah dibuka kembali.', 'This ticket has been reopened.'))],
      components: [this._controlsRow(Boolean(record.claimedBy))],
    });
    await loggingService.logAction(guild, 'Ticket Dibuka Lagi / Ticket Reopened', `${interaction.user.tag} reopened ticket`, { channel: channel.id });
  }

  async handleClaim(interaction) {
    const guild = interaction.guild;
    const channel = interaction.channel;
    const tickets = await configService.getTickets(guild.id);
    const record = tickets[channel.id];
    if (!record) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Bukan ticket', 'Not a ticket'), bi('Channel ini bukan ticket aktif.', 'This channel is not an active ticket.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
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
    const guild = interaction.guild;
    const channel = interaction.channel;
    await interaction.reply({ content: 'Menghapus ticket... / Deleting ticket...', flags: MessageFlags.Ephemeral });
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
    if (config.ticket.staffRoleId && interaction.member.roles.cache.has(config.ticket.staffRoleId)) return true;
    return false;
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
