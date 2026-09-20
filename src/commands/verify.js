import { PermissionFlagsBits, MessageFlags, SlashCommandBuilder, ChannelType } from 'discord.js';
import { errorEmbed, successEmbed, infoEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { verificationService } from '../services/verificationService.js';

export const data = new SlashCommandBuilder()
  .setName('verify')
  .setDescription('Verification system management')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('setup').setDescription('Enable/reconfigure the verification system'))
  .addSubcommand((sub) => sub.setName('panel').setDescription('(Re)post the verification panel in this channel'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show verification configuration status'));

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /verify.', 'Only Administrators can use /verify.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const config = await configService.getGuildConfig(interaction.guild.id);

  if (sub === 'setup') {
    await configService.updateGuildConfig(interaction.guild.id, { verification: { enabled: true } });
    await interaction.reply({
      embeds: [
        successEmbed(
          biTitle('Verifikasi diaktifkan', 'Verification enabled'),
          bi('Gunakan /verify panel di channel verifikasi untuk memasang panelnya.', 'Use /verify panel in your verification channel to post the panel.')
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'panel') {
    if (interaction.channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Channel tidak valid', 'Invalid channel'), bi('Jalankan ini di channel teks.', 'Run this in a text channel.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await verificationService.ensurePanel(interaction.channel);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Panel dipasang', 'Panel posted'), bi('Panel verifikasi sudah siap.', 'Verification panel is ready.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'status') {
    const role = interaction.guild.roles.cache.find((r) => r.name === config.verification.roleName);
    await interaction.reply({
      embeds: [
        infoEmbed(biTitle('Status verifikasi', 'Verification status'), null).addFields(
          { name: 'Aktif / Enabled', value: String(config.verification.enabled), inline: true },
          { name: 'Role', value: role ? `<@&${role.id}>` : 'Belum dibuat / Not created yet', inline: true }
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
