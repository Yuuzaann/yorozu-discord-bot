import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { isBotOwner } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { ACTIVITY_TYPE_CHOICES, PRESENCE_CHOICES, applyStoredStatus } from '../utils/presence.js';

export const data = new SlashCommandBuilder()
  .setName('status')
  .setDescription("Set the bot's Discord status (bot owner only — affects every server)")
  .addSubcommand((sub) =>
    sub
      .setName('set')
      .setDescription('Set the status text, activity type, and presence freely')
      .addStringOption((o) => o.setName('text').setDescription('Status text to display').setRequired(true))
      .addStringOption((o) => o.setName('type').setDescription('Activity type (default: Playing)').addChoices(...ACTIVITY_TYPE_CHOICES))
      .addStringOption((o) => o.setName('presence').setDescription('Online/Idle/DND/Invisible (default: Online)').addChoices(...PRESENCE_CHOICES))
  )
  .addSubcommand((sub) => sub.setName('clear').setDescription('Clear the custom status back to default'));

export async function execute(interaction) {
  if (!(await isBotOwner(interaction))) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          biTitle('Akses ditolak', 'Access denied'),
          bi(
            'Hanya owner bot yang bisa mengubah status — ini berlaku di SEMUA server tempat bot ini ada, bukan cuma server ini.',
            "Only the bot owner can change the status — this affects EVERY server this bot is in, not just this one."
          )
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const sub = interaction.options.getSubcommand();

  if (sub === 'clear') {
    await configService.setBotStatus(null);
    applyStoredStatus(interaction.client, null);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Status dihapus', 'Status cleared'), bi('Status bot dikembalikan ke default (tanpa aktivitas).', "The bot's status has been reset to default (no activity)."))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const text = interaction.options.getString('text', true).slice(0, 128);
  const type = interaction.options.getString('type') ?? 'playing';
  const presence = interaction.options.getString('presence') ?? 'online';

  const status = { text, type, presence };
  await configService.setBotStatus(status);
  applyStoredStatus(interaction.client, status);

  const typeLabel = ACTIVITY_TYPE_CHOICES.find((c) => c.value === type)?.name ?? type;
  const presenceLabel = PRESENCE_CHOICES.find((c) => c.value === presence)?.name ?? presence;

  await interaction.reply({
    embeds: [
      successEmbed(
        biTitle('Status diatur', 'Status set'),
        bi(
          `Status bot sekarang: **${typeLabel} ${text}** (${presenceLabel}). Berlaku langsung di semua server.`,
          `Bot status is now: **${typeLabel} ${text}** (${presenceLabel}). Applied immediately across every server.`
        )
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}
