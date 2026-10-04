import { createLogger } from '../utils/logger.js';
import { infoEmbed } from '../utils/embeds.js';
import { normalizeName } from '../utils/normalize.js';
import { configService } from './configService.js';
import { defaultConfig } from '../config/defaultConfig.js';

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
 * Finds a text channel by its configured name. Discord lowercases text
 * channel names and swaps spaces for dashes on creation ("〔🔗〕ACTION LOG"
 * becomes "〔🔗〕action-log"), so an exact string comparison never matches —
 * both sides are normalized (case/space/symbol-insensitive) instead.
 */
function findLogChannel(guild, configuredName) {
  const target = normalizeName(configuredName);
  return (
    guild.channels.cache.find((c) => c.isTextBased() && !c.isVoiceBased() && normalizeName(c.name) === target) ?? null
  );
}

async function resolveLogging(guild) {
  const config = await configService.getGuildConfig(guild.id);
  return { ...defaultConfig.logging, ...(config.logging ?? {}) };
}

/**
 * Sends structured events to the guild's ⚙️ ┊ BOT LOGS > 〔🔗〕ACTION LOG channel
 * (falling back to console if the channel isn't configured yet).
 * Never forwards token/password/secret fields.
 */
class LoggingService {
  async logAction(guild, title, description, fields = {}) {
    const safeFields = redact(fields);
    try {
      const logging = await resolveLogging(guild);
      if (logging.enabled === false) return;

      const channel = findLogChannel(guild, logging.actionLogChannelName);
      if (!channel) {
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
      const logging = await resolveLogging(guild);
      if (logging.enabled === false) return;

      const channel = findLogChannel(guild, logging.inviteLogChannelName);
      if (!channel) return;
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
