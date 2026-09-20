import { MessageFlags } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import { errorEmbed } from '../utils/embeds.js';
import { configService } from '../services/configService.js';
import { verificationService, VERIFY_BUTTON_ID } from '../services/verificationService.js';
import { roleService, ROLE_SELECT_ID } from '../services/roleService.js';
import {
  ticketService,
  TICKET_CATEGORY_SELECT_ID,
  TICKET_CLOSE_ID,
  TICKET_CLAIM_ID,
  TICKET_DELETE_ID,
  TICKET_REOPEN_ID,
  TICKET_DELETE_CONFIRM_ID,
  TICKET_DELETE_CANCEL_ID,
} from '../services/ticketService.js';
import { SETUP_CONFIRM_ID, SETUP_CANCEL_ID, handleConfirm as handleSetupConfirm, handleCancel as handleSetupCancel } from '../commands/setup.js';
import { successEmbed, warningEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';

const logger = createLogger('InteractionCreateEvent');

export const name = 'interactionCreate';
export const once = false;

export async function execute(interaction, deps) {
  const { commands } = deps;

  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction, deps);
      return;
    }

    if (interaction.isButton()) {
      await handleButton(interaction, deps);
      return;
    }

    if (interaction.isStringSelectMenu()) {
      await handleSelectMenu(interaction, deps);
      return;
    }
  } catch (err) {
    logger.error(`Interaction handling failed (${interaction.type})`, err.stack ?? err.message);
    const payload = {
      embeds: [errorEmbed(biTitle('Error tak terduga', 'Unexpected error'), bi('Terjadi kesalahan saat memproses permintaan.', 'Something went wrong while processing your request.'))],
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => {});
    } else {
      await interaction.reply(payload).catch(() => {});
    }
  }
}

async function handleButton(interaction) {
  const id = interaction.customId;

  if (id === VERIFY_BUTTON_ID) {
    const config = await configService.getGuildConfig(interaction.guild.id);
    return verificationService.handleVerify(interaction, config);
  }

  if (id === SETUP_CONFIRM_ID) return handleSetupConfirm(interaction);
  if (id === SETUP_CANCEL_ID) return handleSetupCancel(interaction);

  if (id === TICKET_CLOSE_ID) return ticketService.handleClose(interaction);
  if (id === TICKET_REOPEN_ID) return ticketService.handleReopen(interaction);
  if (id === TICKET_CLAIM_ID) return ticketService.handleClaim(interaction);
  if (id === TICKET_DELETE_ID) return ticketService.handleDeleteRequest(interaction);
  if (id === TICKET_DELETE_CONFIRM_ID) return ticketService.handleDeleteConfirm(interaction);
  if (id === TICKET_DELETE_CANCEL_ID) return ticketService.handleDeleteCancel(interaction);
}

async function handleSelectMenu(interaction) {
  const id = interaction.customId;

  if (id === TICKET_CATEGORY_SELECT_ID) {
    const config = await configService.getGuildConfig(interaction.guild.id);
    return ticketService.handleCategorySelect(interaction, config);
  }

  if (id === ROLE_SELECT_ID) {
    const config = await configService.getGuildConfig(interaction.guild.id);
    const selectedIds = interaction.values; // multi-select enabled — array of chosen option ids

    const added = [];
    const removed = [];
    const notFound = [];
    const failed = [];
    let refetched = false;

    for (const optionId of selectedIds) {
      const option = config.selfRoles.options.find((o) => o.id === optionId);
      if (!option) continue;

      let role = roleService.findByLabel(interaction.guild, option.label);
      if (!role && !refetched) {
        // Cache might be stale (e.g. role created by another process/restart) — force a fresh fetch once before giving up.
        await interaction.guild.roles.fetch().catch(() => {});
        refetched = true;
        role = roleService.findByLabel(interaction.guild, option.label);
      }
      if (!role) {
        notFound.push(option.label);
        continue;
      }

      try {
        const result = await roleService.toggleSelfRole(interaction.member, role);
        if (result.added) added.push(role.name);
        else removed.push(role.name);
      } catch (err) {
        failed.push(`${role.name}: ${err.message}`);
      }
    }

    const lines = [];
    if (added.length > 0) lines.push(bi(`✅ Ditambahkan: ${added.join(', ')}`, `✅ Added: ${added.join(', ')}`));
    if (removed.length > 0) lines.push(bi(`➖ Dihapus: ${removed.join(', ')}`, `➖ Removed: ${removed.join(', ')}`));
    if (notFound.length > 0) {
      lines.push(bi(`⚠️ Belum dibuat (minta admin /roles setup): ${notFound.join(', ')}`, `⚠️ Not created yet (ask an admin to /roles setup): ${notFound.join(', ')}`));
    }
    if (failed.length > 0) lines.push(bi(`❌ Gagal: ${failed.join(', ')}`, `❌ Failed: ${failed.join(', ')}`));

    const hasIssue = notFound.length > 0 || failed.length > 0;
    const embedBuilder = hasIssue ? warningEmbed : successEmbed;
    await interaction.reply({
      embeds: [embedBuilder(biTitle('Role diperbarui', 'Roles updated'), lines.join('\n') || bi('Tidak ada perubahan.', 'No changes made.'))],
      flags: MessageFlags.Ephemeral,
    });
  }
}
