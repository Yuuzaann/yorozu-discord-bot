import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { welcomeService } from '../services/welcomeService.js';
import { loggingService } from '../services/loggingService.js';
import { roleService } from '../services/roleService.js';
import { communityService } from '../services/communityService.js';

const logger = createLogger('GuildMemberAddEvent');

export const name = 'guildMemberAdd';
export const once = false;

export async function execute(member) {
  try {
    const config = await configService.getGuildConfig(member.guild.id);
    await welcomeService.sendWelcome(member, config);

    if (member.user.bot) {
      // Bots hold no Verified role, so they get Bot / Bot Musik (which also grant channel access).
      await roleService.applyBotRole(member, config).catch((err) => logger.warn(`Bot role failed for ${member.user.tag}`, err.message));
    } else {
      // No verification step → the member is "in" right away. Otherwise Member is granted after /otp.
      if (config.verification.enabled === false) {
        await roleService.grantMemberRole(member, config).catch((err) => logger.warn(`Member role failed for ${member.user.tag}`, err.message));
      }
      await communityService.sendOnboardingDM(member, config);
    }
    await loggingService.logAction(member.guild, 'Member Bergabung / Member Joined', `${member.user?.tag ?? member.id} joined the server.`, {
      user: member.id,
      memberCount: member.guild.memberCount,
    });
  } catch (err) {
    logger.error('guildMemberAdd handling failed', err.message);
  }
}
