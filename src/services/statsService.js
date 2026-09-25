import { ChannelType } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import { configService } from './configService.js';

const logger = createLogger('StatsService');

/**
 * Each stat's display is `${emoji}・${label}: ${count}` — the part before
 * the count (the "prefix") is what we match existing channels against, so
 * updates work purely by scanning channel names in the live guild cache.
 * No setup-time state needed, so this works correctly even right after a
 * bot restart, long after /setup server originally created the channels.
 */
const STAT_TYPES = [
  { type: 'allMembers', emoji: '👤', label: 'All Members' },
  { type: 'members', emoji: '✨', label: 'Members' },
  { type: 'bots', emoji: '🤖', label: 'Bots' },
  { type: 'channels', emoji: '📁', label: 'Channels' },
];

// Discord hard-limits channel name/topic edits to 2 per 10 minutes per
// channel specifically to stop stat-bot abuse — this is why updates are on
// a 10-minute schedule (see index.js) rather than reacting to every join/
// leave/channel change in real time.
class StatsService {
  _prefix(def) {
    return `${def.emoji}・${def.label}:`;
  }

  /** Computes current counts. Fetches the full member list once if the cache looks incomplete (needed for an accurate bot/human split). */
  async computeCounts(guild) {
    if (guild.members.cache.size < guild.memberCount) {
      await guild.members.fetch().catch(() => {});
    }
    const allMembers = guild.memberCount;
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const members = Math.max(allMembers - bots, 0);
    const channels = guild.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory).size;
    return { allMembers, members, bots, channels };
  }

  /** Renames every stat channel found in the guild to match current counts (skips channels whose name is already correct, to avoid burning the rename rate limit for nothing). */
  async updateGuildStats(guild) {
    try {
      const config = await configService.getGuildConfig(guild.id);
      if (!config.serverStats?.enabled) return;

      const counts = await this.computeCounts(guild);

      for (const def of STAT_TYPES) {
        const prefix = this._prefix(def);
        const channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name.startsWith(prefix));
        if (!channel) continue;

        const newName = `${prefix} ${counts[def.type].toLocaleString('en-US')}`;
        if (channel.name === newName) continue;

        await channel.setName(newName).catch((err) => logger.warn(`Failed to rename stat channel "${channel.name}"`, err.message));
      }
    } catch (err) {
      logger.error(`Failed to update server stats for ${guild.name}`, err.message);
    }
  }

  /** Updates stats for every guild the bot is currently in. */
  async updateAllGuilds(client) {
    for (const guild of client.guilds.cache.values()) {
      await this.updateGuildStats(guild);
    }
  }
}

export const statsService = new StatsService();
