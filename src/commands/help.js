import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { primaryEmbed } from '../utils/embeds.js';
import { biTitle } from '../utils/i18n.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('Show available commands');

const SECTIONS = [
  { title: '⚙️ Setup', value: '`/setup preview` `/setup server`' },
  { title: '✅ Verifikasi / Verification', value: '`/verify setup` `/verify panel` `/verify status` `/otp <code>`' },
  { title: '🎭 Role', value: '`/roles setup`' },
  { title: '🎫 Ticket', value: '`/ticket setup` `/ticket close` `/ticket reopen` `/ticket claim` `/ticket delete` `/ticket transcript`' },
  { title: '🔊 Voice', value: '`/voice name` `/voice limit` `/voice lock` `/voice unlock` `/voice claim` `/voice kick` `/voice info`' },
  { title: '🛠️ Config', value: '`/config view` `/config set` `/config staff-role`' },
  { title: '🤖 Bot Status', value: '`/status set` `/status clear` (bot owner only)' },
];

export async function execute(interaction) {
  const embed = primaryEmbed(biTitle('📖 Daftar Command', 'Bot Commands'), null).addFields(SECTIONS.map((s) => ({ name: s.title, value: s.value })));
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
