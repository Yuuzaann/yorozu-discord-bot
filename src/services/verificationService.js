import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { primaryEmbed, successEmbed, errorEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { roleService } from './roleService.js';
import { loggingService } from './loggingService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('VerificationService');

export const VERIFY_BUTTON_ID = 'verify_user';

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

class VerificationService {
  constructor() {
    // userId -> { code, guildId, expiresAt, attempts }
    this.pendingOtps = new Map();
    setInterval(() => this._sweepExpired(), SWEEP_INTERVAL_MS).unref?.();
  }

  _sweepExpired() {
    const now = Date.now();
    for (const [userId, entry] of this.pendingOtps.entries()) {
      if (now > entry.expiresAt) this.pendingOtps.delete(userId);
    }
  }

  _generateOtp() {
    return String(Math.floor(100000 + Math.random() * 900000)); // 6 digit
  }

  buildPanel() {
    const embed = primaryEmbed(
      biTitle('🔐 Verifikasi', 'Verification'),
      bi(
        'Klik tombol di bawah. Bot akan mengirimkan kode OTP lewat DM, lalu ketik `/otp <kode>` untuk membuka seluruh server.',
        'Click the button below. The bot will DM you an OTP code — then type `/otp <code>` to unlock the entire server.'
      )
    );
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(VERIFY_BUTTON_ID).setLabel('Verifikasi / Verify').setEmoji('✅').setStyle(ButtonStyle.Success)
    );
    return { embeds: [embed], components: [row] };
  }

  /** Posts (or re-posts) the verification panel in the given channel, avoiding duplicates. */
  async ensurePanel(channel) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages?.find(
      (m) => m.author.id === channel.client.user.id && m.components?.[0]?.components?.[0]?.customId === VERIFY_BUTTON_ID
    );
    if (existing) return existing;
    return channel.send(this.buildPanel());
  }

  /** Handles a verify button interaction: generates+DMs an OTP (reusing a still-valid one), then tells the member to run /otp. */
  async handleVerify(interaction, config) {
    const guild = interaction.guild;
    let role = roleService.findByLabel(guild, config.verification.roleName);
    if (!role) {
      await guild.roles.fetch().catch(() => {});
      role = roleService.findByLabel(guild, config.verification.roleName);
    }
    if (!role) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Verifikasi tidak tersedia', 'Verification unavailable'),
            bi('Role Verified tidak ditemukan. Minta admin menjalankan /setup server.', 'Verified role not found. Ask an admin to run /setup server.')
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (interaction.member.roles.cache.has(role.id)) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('⚠️ Sudah terverifikasi', 'Already verified'), bi('Kamu sudah terverifikasi sebelumnya. Verifikasi hanya bisa dilakukan sekali.', "You're already verified. Verification can only be done once."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const existing = this.pendingOtps.get(interaction.user.id);
    const reuseExisting = existing && existing.guildId === guild.id && Date.now() < existing.expiresAt;

    if (!reuseExisting) {
      const code = this._generateOtp();
      this.pendingOtps.set(interaction.user.id, { code, guildId: guild.id, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });

      try {
        await interaction.user.send({
          embeds: [
            primaryEmbed(
              biTitle('🔐 Kode Verifikasi', 'Verification Code'),
              bi(
                `Kode OTP kamu untuk **${guild.name}** adalah **${code}**. Berlaku 5 menit. Kembali ke server dan ketik \`/otp ${code}\` untuk menyelesaikan verifikasi.`,
                `Your OTP code for **${guild.name}** is **${code}**. Valid for 5 minutes. Go back to the server and type \`/otp ${code}\` to finish verifying.`
              )
            ),
          ],
        });
      } catch (err) {
        this.pendingOtps.delete(interaction.user.id);
        logger.warn(`Failed to DM OTP to ${interaction.user.tag}`, err.message);
        await interaction.reply({
          embeds: [
            errorEmbed(
              biTitle('DM gagal terkirim', 'DM failed to send'),
              bi(
                "Bot tidak bisa mengirim DM. Aktifkan 'Allow direct messages from server members' di Privacy Settings server ini, lalu klik Verify lagi.",
                "The bot couldn't DM you. Enable 'Allow direct messages from server members' in this server's Privacy Settings, then click Verify again."
              )
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
    }

    await interaction.reply({
      embeds: [
        primaryEmbed(
          biTitle('📩 OTP Terkirim', 'OTP Sent'),
          bi(
            'Kode OTP sudah dikirim lewat DM. Cek DM kamu, lalu gunakan perintah `/otp <kode>` untuk menyelesaikan verifikasi.',
            'The OTP code has been sent via DM. Check your DM, then use the `/otp <code>` command to complete verification.'
          )
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }

  /** Handles /otp <code>. */
  async handleOtpCommand(interaction, config) {
    const entered = interaction.options.getString('code', true).trim();
    return this._verifyEnteredCode(interaction, config, entered);
  }

  async _verifyEnteredCode(interaction, config, entered) {
    const guild = interaction.guild;
    const pending = this.pendingOtps.get(interaction.user.id);

    if (!pending || pending.guildId !== guild.id) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Tidak ada OTP aktif', 'No active OTP'),
            bi('Sesi OTP kamu tidak ditemukan atau sudah kedaluwarsa. Klik tombol Verify lagi.', 'Your OTP session was not found or has expired. Click the Verify button again.')
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (Date.now() > pending.expiresAt) {
      this.pendingOtps.delete(interaction.user.id);
      await interaction.reply({
        embeds: [
          errorEmbed(biTitle('OTP kedaluwarsa', 'OTP expired'), bi('Kode OTP sudah kedaluwarsa. Klik tombol Verify lagi untuk dapat kode baru.', 'The OTP code has expired. Click the Verify button again for a new code.')),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (entered !== pending.code) {
      pending.attempts += 1;
      if (pending.attempts >= MAX_ATTEMPTS) {
        this.pendingOtps.delete(interaction.user.id);
        await interaction.reply({
          embeds: [
            errorEmbed(
              biTitle('Terlalu banyak percobaan', 'Too many attempts'),
              bi('Kamu salah memasukkan kode terlalu banyak kali. Klik tombol Verify lagi untuk dapat kode baru.', 'You entered the wrong code too many times. Click the Verify button again for a new code.')
            ),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Kode salah', 'Wrong code'),
            bi(
              `Kode yang kamu masukkan salah. Sisa percobaan: ${MAX_ATTEMPTS - pending.attempts}. Cek lagi DM kamu dan coba \`/otp <kode>\` lagi.`,
              `The code you entered is wrong. Attempts left: ${MAX_ATTEMPTS - pending.attempts}. Double-check your DM and try \`/otp <code>\` again.`
            )
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Correct code.
    this.pendingOtps.delete(interaction.user.id);
    let role = roleService.findByLabel(guild, config.verification.roleName);
    if (!role) {
      await guild.roles.fetch().catch(() => {});
      role = roleService.findByLabel(guild, config.verification.roleName);
    }
    if (!role) {
      await interaction.reply({
        embeds: [
          errorEmbed(
            biTitle('Verifikasi tidak tersedia', 'Verification unavailable'),
            bi('Role Verified tidak ditemukan. Minta admin menjalankan /setup server.', 'Verified role not found. Ask an admin to run /setup server.')
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      const result = await roleService.addVerifiedRole(interaction.member, role);
      if (result.alreadyVerified) {
        await interaction.reply({
          embeds: [errorEmbed(biTitle('⚠️ Sudah terverifikasi', 'Already verified'), bi('Kamu sudah terverifikasi sebelumnya. Verifikasi hanya bisa dilakukan sekali.', "You're already verified. Verification can only be done once."))],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.reply({
        embeds: [successEmbed(biTitle('Terverifikasi', 'Verified'), bi('✅ Verifikasi berhasil! Selamat datang.', '✅ Verification successful! Welcome.'))],
        flags: MessageFlags.Ephemeral,
      });
      await loggingService.logAction(guild, 'Verifikasi / Verification', `${interaction.user.tag} verified via OTP.`, { user: interaction.user.id });
    } catch (err) {
      logger.error('Verify failed', err.message);
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Verifikasi gagal', 'Verification failed'), err.message)],
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}

export const verificationService = new VerificationService();
