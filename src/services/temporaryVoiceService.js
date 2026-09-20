import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { applyTemplate, toChannelSafeName } from '../utils/normalize.js';
import { loggingService } from './loggingService.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TemporaryVoiceService');

/**
 * In-memory registry of temp voice channels. Not persisted to disk on
 * purpose — on restart, orphaned temp channels are swept by
 * `sweepOrphans` since they carry no permanent-channel flag.
 * Map<channelId, { guildId, ownerId, categoryId, deleteTimer }>
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

  /** Creates a room for `member` in the same category as the trigger channel, and moves them in. */
  async createRoomFor(member, triggerChannel, config) {
    const name = applyTemplate(config.temporaryVoice.nameFormat, { username: member.user.username });
    const safeName = toChannelSafeName(name, `${member.user.username}'s Room`);
    const guild = member.guild;
    const room = await guild.channels.create({
      name: `🔊・${member.user.username}'s Room`.slice(0, 100),
      type: ChannelType.GuildVoice,
      parent: triggerChannel.parentId,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect] },
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
    this.channels.set(room.id, { guildId: guild.id, ownerId: member.id, categoryId: triggerChannel.parentId });
    await member.voice.setChannel(room).catch((err) => logger.warn('Failed to move member into new room', err.message));
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
      if (!fresh || fresh.members.size > 0) return;
      try {
        await fresh.delete('Temporary voice cleanup: empty channel');
        this.channels.delete(channel.id);
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

  async transferOwnership(channelId, newOwnerId) {
    const entry = this.channels.get(channelId);
    if (!entry) return false;
    entry.ownerId = newOwnerId;
    return true;
  }
}

export const temporaryVoiceService = new TemporaryVoiceService();
