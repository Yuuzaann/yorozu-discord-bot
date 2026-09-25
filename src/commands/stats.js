import { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } from 'discord.js';
import { successEmbed, errorEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { statsService } from '../services/statsService.js';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Server stats channel management')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('refresh').setDescription('Force-refresh the server stats channels right now'));

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /stats.', 'Only Administrators can use /stats.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await statsService.updateGuildStats(interaction.guild);
  await interaction.editReply({
    embeds: [successEmbed(biTitle('Stats diperbarui', 'Stats refreshed'), bi('Channel server stats sudah diperbarui.', 'Server stats channels have been refreshed.'))],
  });
}
