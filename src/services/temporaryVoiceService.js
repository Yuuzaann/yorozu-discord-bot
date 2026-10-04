import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { applyTemplate } from '../utils/normalize.js';
import { loggingService } from './loggingService.js';
import { configService } from './configService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TemporaryVoiceService');

/**
 * Registry of temp voice channels: Map<channelId, { guildId, ownerId, categoryId, deleteTimer }>.
 * Kept in memory for speed, and mirrored (ids + owner only) into each guild's
 * persisted state so `sweepOrphans` can clean up / re-adopt rooms after a restart.
 */
class TemporaryVoiceService {
  constructor() {
    this.channels = new Map();
  }

  isPermanent(channel, config) {
    return config.temporaryVoice.triggerChannelNames.includes(channel.name) || channel.name.includes('AFK');
  }

  isTrigger(channel, config) {
    return config.temporaryVoice.triggerChannelNames.includes(channel.name);
  }

  isManaged(channelId) {
    return this.channels.has(channelId);
  }

  getOwner(channelId) {
    return this.channels.get(channelId)?.ownerId ?? null;
  }

  /** Writes this guild's slice of the registry to persisted state. */
  async _persist(guildId) {
    const map = {};
    for (const [channelId, entry] of this.channels) {
      if (entry.guildId === guildId) map[channelId] = { ownerId: entry.ownerId, categoryId: entry.categoryId, waitingId: entry.waitingId ?? null };
    }
    await configService.updateGuildState(guildId, { tempVoiceChannels: map }).catch((err) => logger.warn('Failed to persist temp voice registry', err.message));
  }

  /**
   * Run once on startup. Rooms recorded before the restart are either deleted
   * (if empty — nobody is left to trigger the normal cleanup) or re-adopted
   * (if people are still inside) so /voice commands and cleanup keep working.
   */
  async sweepOrphans(client) {
    for (const guild of client.guilds.cache.values()) {
      const state = await configService.getGuildState(guild.id);
      const saved = state.tempVoiceChannels ?? {};
      const ids = Object.keys(saved);
      if (ids.length === 0) continue;

      for (const channelId of ids) {
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        if (!channel || channel.type !== ChannelType.GuildVoice) {
          // Room already gone — make sure its waiting room doesn't linger.
          if (saved[channelId].waitingId) await guild.channels.delete(saved[channelId].waitingId, 'Temporary voice cleanup: orphaned waiting room').catch(() => {});
          continue;
        }

        if (channel.members.size === 0) {
          if (saved[channelId].waitingId) await guild.channels.delete(saved[channelId].waitingId, 'Temporary voice cleanup: orphaned waiting room').catch(() => {});
          await channel.delete('Temporary voice cleanup: orphaned empty room after restart').catch((err) => logger.warn(`Failed to delete orphaned room ${channelId}`, err.message));
          continue;
        }
        this.channels.set(channelId, {
          guildId: guild.id,
          ownerId: saved[channelId].ownerId ?? null,
          categoryId: saved[channelId].categoryId ?? null,
          waitingId: saved[channelId].waitingId ?? null,
          deleteTimer: null,
        });
      }
      await this._persist(guild.id);
    }
  }

  /** Creates a room for `member` in the same category as the trigger channel, and moves them in. */
  async createRoomFor(member, triggerChannel, config) {
    const guild = member.guild;
    const name =
      applyTemplate(config.temporaryVoice.nameFormat, { username: member.user.username }).trim().slice(0, 100) ||
      `🔊・${member.user.username}'s Room`.slice(0, 100);

    // Start from the category's own permission overwrites (so a room is exactly as
    // visible/joinable as the category it sits in — e.g. hidden from unverified
    // members), then add the owner's management rights on top.
    const source = triggerChannel.parent?.permissionOverwrites?.cache ?? triggerChannel.permissionOverwrites.cache;
    const inherited = [...source.values()]
      .filter((o) => o.id !== member.id)
      .map((o) => ({ id: o.id, type: o.type, allow: o.allow, deny: o.deny }));

    const room = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: triggerChannel.parentId ?? undefined,
      permissionOverwrites: [
        ...inherited,
        {
          id: member.id,
          allow: [
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.MoveMembers,
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.Connect,
          ],
        },
      ],
      reason: `Temporary voice room for ${member.user.tag}`,
    });
    this.channels.set(room.id, { guildId: guild.id, ownerId: member.id, categoryId: triggerChannel.parentId, deleteTimer: null });
    await this._persist(guild.id);

    try {
      await member.voice.setChannel(room);
    } catch (err) {
      logger.warn('Failed to move member into new room', err.message);
      // The member is not in the room (e.g. they left in the meantime) — nobody will ever
      // trigger the "channel became empty" cleanup, so schedule it right away.
      this.scheduleCleanup(room, config);
    }
    await loggingService.logAction(guild, 'Voice Sementara Dibuat / Temp Voice Created', `Room created for ${member.user.tag}`, { channel: room.id });
    return room;
  }

  /** Called on voiceStateUpdate when a managed channel becomes empty. Schedules deletion. */
  scheduleCleanup(channel, config) {
    const entry = this.channels.get(channel.id);
    if (!entry) return;
    if (entry.deleteTimer) clearTimeout(entry.deleteTimer);
    entry.deleteTimer = setTimeout(async () => {
      const fresh = await channel.guild.channels.fetch(channel.id).catch(() => null);
      if (!fresh) {
        // Already deleted by someone else — just forget it.
        this.channels.delete(channel.id);
        await this._persist(channel.guild.id);
        return;
      }
      if (fresh.members.size > 0) return;
      try {
        if (entry.waitingId) await channel.guild.channels.delete(entry.waitingId, 'Temporary voice cleanup: room removed').catch(() => {});
        await fresh.delete('Temporary voice cleanup: empty channel');
        this.channels.delete(channel.id);
        await this._persist(channel.guild.id);
        await loggingService.logAction(channel.guild, 'Voice Sementara Dihapus / Temp Voice Deleted', `Empty room removed`, { channel: channel.id });
      } catch (err) {
        logger.error('Failed to delete empty temp voice channel', err.message);
      }
    }, config.temporaryVoice.deleteDelay);
  }

  /** Called when a member (re)joins a managed channel — cancels a pending deletion. */
  cancelCleanup(channelId) {
    const entry = this.channels.get(channelId);
    if (entry?.deleteTimer) {
      clearTimeout(entry.deleteTimer);
      entry.deleteTimer = null;
    }
  }

  getWaiting(channelId) {
    return this.channels.get(channelId)?.waitingId ?? null;
  }

  async setWaiting(channelId, waitingId) {
    const entry = this.channels.get(channelId);
    if (!entry) return false;
    entry.waitingId = waitingId;
    await this._persist(entry.guildId);
    return true;
  }

  /** Deletes a room together with its waiting room and forgets it (used by the interface's Delete button). */
  async removeRoom(channel, reason) {
    const entry = this.channels.get(channel.id);
    if (entry?.deleteTimer) clearTimeout(entry.deleteTimer);
    if (entry?.waitingId) await channel.guild.channels.delete(entry.waitingId, reason).catch(() => {});
    this.channels.delete(channel.id);
    await this._persist(channel.guild.id);
    await channel.delete(reason);
    await loggingService.logAction(channel.guild, 'Voice Sementara Dihapus / Temp Voice Deleted', 'Room deleted by its owner', { channel: channel.id });
  }

  async transferOwnership(channelId, newOwnerId) {
    const entry = this.channels.get(channelId);
    if (!entry) return false;
    entry.ownerId = newOwnerId;
    await this._persist(entry.guildId);
    return true;
  }
}

export const temporaryVoiceService = new TemporaryVoiceService();
