import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { temporaryVoiceService } from '../services/temporaryVoiceService.js';

const logger = createLogger('VoiceStateUpdateEvent');

export const name = 'voiceStateUpdate';
export const once = false;

export async function execute(oldState, newState) {
  const guild = newState.guild ?? oldState.guild;
  try {
    const config = await configService.getGuildConfig(guild.id);

    // Handle joining a trigger channel -> create a personal room.
    if (newState.channelId && newState.channel && temporaryVoiceService.isTrigger(newState.channel, config)) {
      if (config.temporaryVoice.enabled) {
        await temporaryVoiceService.createRoomFor(newState.member, newState.channel, config);
      }
    }

    // A member joined a managed temp room -> cancel any pending cleanup.
    if (newState.channelId && temporaryVoiceService.isManaged(newState.channelId)) {
      temporaryVoiceService.cancelCleanup(newState.channelId);
    }

    // A channel was left -> check if it's now empty (temp voice cleanup).
    if (oldState.channelId && oldState.channelId !== newState.channelId) {
      const leftChannel = oldState.channel;
      if (leftChannel) {
        const nowEmpty = leftChannel.members.size === 0;

        // Temp voice room cleanup.
        if (nowEmpty && temporaryVoiceService.isManaged(leftChannel.id) && !temporaryVoiceService.isPermanent(leftChannel, config)) {
          temporaryVoiceService.scheduleCleanup(leftChannel, config);
        }
      }
    }
  } catch (err) {
    logger.error('voiceStateUpdate handling failed', err.message);
  }
}
