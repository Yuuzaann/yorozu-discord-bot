import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, successEmbed, warningEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { roleService } from '../services/roleService.js';

export const data = new SlashCommandBuilder()
  .setName('roles')
  .setDescription('Self-role management')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('setup').setDescription('(Re)post the take-role panel in this channel'))
  .addSubcommand((sub) => sub.setName('sync').setDescription('Give Member / Bot / Bot Musik roles to everyone already in the server'))
  .addSubcommand((sub) =>
    sub
      .setName('musicbot')
      .setDescription('Mark a bot as music bot (Bot Musik role) or as a normal bot (Bot role)')
      .addUserOption((o) => o.setName('bot').setDescription('The bot').setRequired(true))
      .addBooleanOption((o) => o.setName('enabled').setDescription('true = music bot (default), false = normal bot'))
  );

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /roles.', 'Only Administrators can use /roles.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = interaction.options.getSubcommand();

  if (sub === 'sync') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const config = await configService.getGuildConfig(interaction.guild.id);
    await roleService.ensureCoreRoles(interaction.guild, config);
    const result = await roleService.syncAutoRoles(interaction.guild, config);
    const text = bi(
      `Bot diberi role: ${result.bots}, member diberi role: ${result.members}, gagal: ${result.failed}.`,
      `Bots given a role: ${result.bots}, members given a role: ${result.members}, failed: ${result.failed}.`
    );
    const embed = result.failed > 0 ? warningEmbed : successEmbed;
    await interaction.editReply({
      embeds: [embed(biTitle('Sinkronisasi role', 'Role sync'), result.firstError ? `${text}\n${result.firstError}` : text)],
    });
    return;
  }

  if (sub === 'musicbot') {
    const user = interaction.options.getUser('bot', true);
    const enabled = interaction.options.getBoolean('enabled') ?? true;
    const target = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!target?.user.bot) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Bukan bot', 'Not a bot'), bi('Pilih akun bot yang ada di server ini.', 'Pick a bot account that is in this server.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const config = await configService.getGuildConfig(interaction.guild.id);
      await roleService.ensureCoreRoles(interaction.guild, config);
      const { role } = await roleService.setMusicBot(target, config, enabled);
      await interaction.editReply({
        embeds: [successEmbed(biTitle('Bot diperbarui', 'Bot updated'), bi(`${target} sekarang memakai role **${role?.name ?? '-'}**.`, `${target} now has the **${role?.name ?? '-'}** role.`))],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(biTitle('Gagal', 'Failed'), err.message)] });
    }
    return;
  }

  if (interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Channel tidak valid', 'Invalid channel'), bi('Jalankan ini di channel teks.', 'Run this in a text channel.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Creating/pruning roles takes several API calls — defer so the reply can't miss the 3-second window.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const config = await configService.getGuildConfig(interaction.guild.id);
  await roleService.ensureCoreRoles(interaction.guild, config);
  await roleService.ensureTakeRolePanel(interaction.channel, config);
  await interaction.editReply({
    embeds: [successEmbed(biTitle('Panel dipasang', 'Panel posted'), bi('Panel take-role sudah siap.', 'Take-role panel is ready.'))],
  });
}
