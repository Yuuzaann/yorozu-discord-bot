import { AttachmentBuilder, ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { ticketService } from '../services/ticketService.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket system management')
  .addSubcommand((sub) => sub.setName('setup').setDescription('(Admin) (Re)post the ticket panel in this channel'))
  .addSubcommand((sub) => sub.setName('close').setDescription('Close this ticket'))
  .addSubcommand((sub) => sub.setName('reopen').setDescription('Reopen this ticket'))
  .addSubcommand((sub) => sub.setName('claim').setDescription('Claim this ticket'))
  .addSubcommand((sub) => sub.setName('delete').setDescription('Delete this ticket'))
  .addSubcommand((sub) => sub.setName('transcript').setDescription('Generate a transcript for this ticket'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const config = await configService.getGuildConfig(interaction.guild.id);

  if (sub === 'setup') {
    if (!isAdmin(interaction.member)) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /ticket setup.', 'Only Administrators can use /ticket setup.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Channel tidak valid', 'Invalid channel'), bi('Jalankan ini di channel teks.', 'Run this in a text channel.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await ticketService.ensurePanel(interaction.channel, config);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Panel dipasang', 'Panel posted'), bi('Panel ticket sudah siap.', 'Ticket panel is ready.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tickets = await configService.getTickets(interaction.guild.id);
  const record = tickets[interaction.channel.id];
  if (!record) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Bukan ticket', 'Not a ticket'), bi('Command ini hanya dapat digunakan di dalam channel ticket.', 'This command can only be used inside a ticket channel.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const canManage = await ticketService.canManage(interaction, config, record);
  if (!canManage) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya owner, staff, atau admin yang dapat melakukan ini.', 'Only the owner, staff, or an admin can do this.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'close') return ticketService.handleClose(interaction);
  if (sub === 'reopen') return ticketService.handleReopen(interaction);
  if (sub === 'claim') return ticketService.handleClaim(interaction);
  if (sub === 'delete') return ticketService.handleDeleteRequest(interaction);

  if (sub === 'transcript') {
    if (!config.ticket.transcriptEnabled) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Dinonaktifkan', 'Disabled'), bi('Fitur transcript dinonaktifkan untuk server ini.', 'Transcript feature is disabled for this server.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const text = await ticketService.buildTranscript(interaction.channel);
    const file = new AttachmentBuilder(Buffer.from(text || 'No messages.', 'utf-8'), { name: `transcript-${interaction.channel.id}.txt` });
    await interaction.editReply({
      embeds: [successEmbed(biTitle('Transcript dibuat', 'Transcript generated'), null)],
      files: [file],
    });
  }
}
