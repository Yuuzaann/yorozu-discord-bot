import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';

export const data = new SlashCommandBuilder()
  .setName('config')
  .setDescription('View or edit bot configuration')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName('view').setDescription('Show current configuration'))
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Set a configuration value')
      .addStringOption((o) =>
        o
          .setName('key')
          .setDescription('Dotted config key, e.g. ticket.maxTicketsPerUser')
          .setRequired(true)
      )
      .addStringOption((o) => o.setName('value').setDescription('New value').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('staff-role').setDescription('Set the ticket staff role').addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)));

function setDeep(obj, dottedKey, value) {
  const keys = dottedKey.split('.');
  const patch = {};
  let cursor = patch;
  keys.forEach((key, i) => {
    if (i === keys.length - 1) {
      cursor[key] = value;
    } else {
      cursor[key] = {};
      cursor = cursor[key];
    }
  });
  return patch;
}

function coerce(value) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (!Number.isNaN(Number(value)) && value.trim() !== '') return Number(value);
  return value;
}

export async function execute(interaction) {
  if (!isAdmin(interaction.member)) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /config.', 'Only Administrators can use /config.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;

  if (sub === 'view') {
    const config = await configService.getGuildConfig(guildId);
    const json = JSON.stringify(config, null, 2);
    await interaction.reply({
      embeds: [infoEmbed(biTitle('Konfigurasi', 'Configuration'), `\`\`\`json\n${json.slice(0, 3800)}\n\`\`\``)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'set') {
    const key = interaction.options.getString('key', true);
    const rawValue = interaction.options.getString('value', true);
    const patch = setDeep({}, key, coerce(rawValue));
    await configService.updateGuildConfig(guildId, patch);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Config diperbarui', 'Config updated'), `Set \`${key}\` = \`${rawValue}\``)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'staff-role') {
    const role = interaction.options.getRole('role', true);
    await configService.updateGuildConfig(guildId, { ticket: { staffRoleId: role.id } });
    await interaction.reply({
      embeds: [successEmbed(biTitle('Role staff diatur', 'Staff role set'), `Role staff ticket diatur ke / Ticket staff role set to <@&${role.id}>`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
