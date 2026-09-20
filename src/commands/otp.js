import { SlashCommandBuilder } from 'discord.js';
import { configService } from '../services/configService.js';
import { verificationService } from '../services/verificationService.js';

export const data = new SlashCommandBuilder()
  .setName('otp')
  .setDescription('Masukkan kode OTP verifikasi kamu / Enter your verification OTP code')
  .addStringOption((o) =>
    o.setName('code').setDescription('Kode 6 digit dari DM / 6-digit code from your DM').setRequired(true).setMinLength(6).setMaxLength(6)
  );

export async function execute(interaction) {
  const config = await configService.getGuildConfig(interaction.guild.id);
  await verificationService.handleOtpCommand(interaction, config);
}
