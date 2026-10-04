import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { defaultConfig } from '../config/defaultConfig.js';

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

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Looks the dotted key up in the default config. Unknown keys are rejected so typos can't silently create junk settings. */
function findDefault(dottedKey) {
  let cursor = defaultConfig;
  for (const part of dottedKey.split('.')) {
    if (UNSAFE_KEYS.has(part) || cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, part)) {
      return { found: false };
    }
    cursor = cursor[part];
  }
  return { found: true, value: cursor };
}

function setDeep(_obj, dottedKey, value) {
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

/**
 * Converts the raw text to the same type as the setting's default. Typing by the
 * default (not by "does it look like a number") matters: Discord IDs such as
 * ticket.staffRoleId are 18-19 digit strings, and turning them into a JS Number
 * silently rounds them to a different, wrong ID.
 */
function parseValue(raw, defaultValue) {
  const text = raw.trim();
  if (typeof defaultValue === 'boolean') {
    if (text.toLowerCase() === 'true') return { ok: true, value: true };
    if (text.toLowerCase() === 'false') return { ok: true, value: false };
    return { ok: false, expected: 'true / false' };
  }
  if (typeof defaultValue === 'number') {
    const num = Number(text);
    if (text === '' || !Number.isFinite(num)) return { ok: false, expected: 'a number' };
    return { ok: true, value: num };
  }
  if (typeof defaultValue === 'string') return { ok: true, value: raw };
  if (defaultValue === null) return { ok: true, value: text.toLowerCase() === 'null' ? null : raw };
  // Arrays / nested objects: accept JSON of the same kind.
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(defaultValue) === Array.isArray(parsed) && parsed !== null && typeof parsed === 'object') {
      return { ok: true, value: parsed };
    }
  } catch {
    // fall through to the error below
  }
  return { ok: false, expected: Array.isArray(defaultValue) ? 'a JSON array' : 'a JSON object' };
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
    const target = findDefault(key);
    if (!target.found) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Key tidak dikenal', 'Unknown key'), bi(`Key \`${key}\` tidak ada. Pakai \`/config view\` untuk melihat key yang valid.`, `Key \`${key}\` doesn't exist. Use \`/config view\` to see the valid keys.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const parsed = parseValue(rawValue, target.value);
    if (!parsed.ok) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Nilai tidak valid', 'Invalid value'), bi(`\`${key}\` harus berupa ${parsed.expected}.`, `\`${key}\` must be ${parsed.expected}.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const patch = setDeep({}, key, parsed.value);
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
