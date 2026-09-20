import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { roleService } from '../services/roleService.js';

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Self-role management')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('setup').setDescription('(Re)post the take-role panel in this channel'));

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /roles.', 'Only Administrators can use /roles.'))],
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
  const config = await configService.getGuildConfig(interaction.guild.id);
  await roleService.ensureCoreRoles(interaction.guild, config);
  await roleService.ensureTakeRolePanel(interaction.channel, config);
  await interaction.reply({
    embeds: [successEmbed(biTitle('Panel dipasang', 'Panel posted'), bi('Panel take-role sudah siap.', 'Take-role panel is ready.'))],
    flags: MessageFlags.Ephemeral,
  });
}
