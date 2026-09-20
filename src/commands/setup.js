import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, primaryEmbed, successEmbed, warningEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { botHasSetupPermissions, isAdmin } from '../utils/permissions.js';
import { serverSetupService } from '../services/serverSetup.js';
import { configService } from '../services/configService.js';
import { loggingService } from '../services/loggingService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('SetupCommand');

export const SETUP_CONFIRM_ID = 'setup_confirm';
export const SETUP_CANCEL_ID = 'setup_cancel';

export const data = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Server setup and reset')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('preview').setDescription('Preview the structure setup would create (no changes made)'))
  .addSubcommand((sub) => sub.setName('server').setDescription('Reset and rebuild the entire server structure'));

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /setup.', 'Only Administrators can use /setup.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'preview') {
    const preview = serverSetupService.buildPreviewText();
    await interaction.reply({
      embeds: [
        primaryEmbed(biTitle('📋 Pratinjau Setup', 'Setup Preview'), preview).setFooter({
          text: 'Belum ada perubahan yang dibuat. / No changes have been made yet.',
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'server') {
    if (!botHasSetupPermissions(interaction.guild)) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Izin kurang', 'Missing permissions'),
            bi('Bot memerlukan izin Manage Channels dan Manage Roles untuk menjalankan setup.', 'Bot requires Manage Channels and Manage Roles to run setup.')
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (serverSetupService.isLocked(interaction.guild.id)) {
      await interaction.reply({
        embeds: [warningEmbed(biTitle('Setup sedang berjalan', 'Setup in progress'), bi('Setup sudah berjalan untuk server ini.', 'A setup is already running for this server.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(SETUP_CONFIRM_ID).setLabel('Ya, Reset / Confirm Reset').setEmoji('🔴').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId(SETUP_CANCEL_ID).setLabel('Batal / Cancel').setEmoji('⚪').setStyle(ButtonStyle.Secondary)
    );

    await interaction.reply({
      embeds: [
        warningEmbed(
          '⚠️ RESET SERVER',
          bi(
            'Semua category dan channel yang ada akan dihapus dan dibuat ulang.',
            'All existing categories and channels will be deleted and recreated.'
          )
        ),
      ],
      components: [row],
    });
  }
}

export async function handleConfirm(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat mengonfirmasi ini.', 'Only Administrators can confirm this.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guild = interaction.guild;
  if (serverSetupService.isLocked(guild.id)) {
    await interaction.update({
      embeds: [warningEmbed(biTitle('Setup sedang berjalan', 'Setup in progress'), bi('Setup sudah berjalan.', 'A setup is already running.'))],
      components: [],
    });
    return;
  }

  serverSetupService.lock(guild.id);
  await interaction.update({
    embeds: [
      primaryEmbed(
        biTitle('⏳ Mereset server...', 'Resetting server...'),
        bi('Proses ini bisa memakan waktu tergantung ukuran server.', 'This may take a while depending on server size.')
      ),
    ],
    components: [],
  });

  try {
    const config = await configService.getGuildConfig(guild.id);
    const report = await serverSetupService.runFullSetup(guild, config);

    const summaryLines = [
      `Categories created / Kategori dibuat: ${report.createdCategories}`,
      `Channels created / Channel dibuat: ${report.createdChannels}`,
      `Roles ensured / Role dipastikan ada: ${report.createdRoles}`,
    ];
    if (report.failedDeletions.length > 0) {
      summaryLines.push(`Failed to delete / Gagal dihapus: ${report.failedDeletions.join(', ')}`);
    }
    if (report.errors.length > 0) {
      summaryLines.push(`Errors / Error: ${report.errors.join(' | ')}`);
    }

    const embed = report.success && report.errors.length === 0
      ? successEmbed(biTitle('✅ Setup Selesai', 'Setup Complete'), summaryLines.join('\n'))
      : warningEmbed(biTitle('⚠️ Setup Selesai dengan Masalah', 'Setup Completed With Issues'), summaryLines.join('\n'));

    await reportFinalResult(interaction, guild, embed);
    await loggingService.logAction(guild, report.success ? 'Setup Selesai / Setup Completed' : 'Setup Gagal / Setup Failed', summaryLines.join('\n'));
  } catch (err) {
    logger.error('Setup crashed', err.message);
    await reportFinalResult(interaction, guild, errorEmbed(biTitle('Setup gagal', 'Setup failed'), err.message));
    await loggingService.logAction(guild, 'Setup Gagal / Setup Failed', err.message);
  } finally {
    serverSetupService.unlock(guild.id);
  }
}

/**
 * Delivers the final setup report even if the original reply message no
 * longer exists — which happens whenever an admin runs /setup server from a
 * channel that the reset itself deletes (DiscordAPIError 10008: Unknown
 * Message on editReply). Tries, in order: edit the original reply, post a
 * fresh follow-up on the same interaction, then DM the admin as a last
 * resort (the interaction token can also go stale after ~15 minutes).
 */
async function reportFinalResult(interaction, guild, embed) {
  try {
    await interaction.editReply({ embeds: [embed] });
    return;
  } catch (err) {
    logger.warn('editReply failed (original message likely gone), trying followUp', err.message);
  }
  try {
    await interaction.followUp({ embeds: [embed] });
    return;
  } catch (err) {
    logger.warn('followUp failed too, falling back to DM', err.message);
  }
  try {
    await interaction.user.send({ embeds: [embed.setFooter({ text: `Result for /setup server in ${guild.name}` })] });
  } catch (err) {
    logger.error('Could not deliver setup result via editReply, followUp, or DM', err.message);
  }
}

export async function handleCancel(interaction) {
  await interaction.update({
    embeds: [primaryEmbed(biTitle('Dibatalkan', 'Cancelled'), bi('Reset server dibatalkan. Tidak ada perubahan yang dibuat.', 'Server reset cancelled. No changes were made.'))],
    components: [],
  });
}
