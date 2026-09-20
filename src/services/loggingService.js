import { createLogger } from '../utils/logger.js';
import { infoEmbed } from '../utils/embeds.js';

const logger = createLogger('LoggingService');

const SENSITIVE_KEY_PATTERN = /token|password|secret/i;

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const clone = {};
  for (const [key, value] of Object.entries(meta)) {
    clone[key] = SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : value;
  }
  return clone;
}

/**
 * Sends structured events to the guild's ⚙️ Bot Logs > action-log channel
 * (falling back to console if the channel isn't configured yet).
 * Never forwards token/password/secret fields.
 */
class LoggingService {
  async logAction(guild, title, description, fields = {}) {
    const safeFields = redact(fields);
    try {
      const channel = guild.channels.cache.find((c) => c.name === '🔗・action-log');
      if (!channel || !channel.isTextBased()) {
        logger.info(`[${guild.name}] ${title}: ${description}`, safeFields);
        return;
      }
      const embed = infoEmbed(title, description);
      const entries = Object.entries(safeFields);
      if (entries.length > 0) {
        embed.addFields(entries.map(([name, value]) => ({ name, value: String(value), inline: true })));
      }
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error('Failed to write action log', err.message);
    }
  }

  async logInvite(guild, description, fields = {}) {
    try {
      const channel = guild.channels.cache.find((c) => c.name === '🔗・invite-log');
      if (!channel || !channel.isTextBased()) return;
      const embed = infoEmbed('Invite Event / Event Undangan', description);
      const entries = Object.entries(redact(fields));
      if (entries.length > 0) {
        embed.addFields(entries.map(([name, value]) => ({ name, value: String(value), inline: true })));
      }
      await channel.send({ embeds: [embed] });
    } catch (err) {
      logger.error('Failed to write invite log', err.message);
    }
  }
}

export const loggingService = new LoggingService();
