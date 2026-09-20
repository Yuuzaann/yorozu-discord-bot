import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { welcomeService } from '../services/welcomeService.js';
import { loggingService } from '../services/loggingService.js';

const logger = createLogger('GuildMemberAddEvent');

export const name = 'guildMemberAdd';
export const once = false;

export async function execute(member) {
  try {
    const config = await configService.getGuildConfig(member.guild.id);
    await welcomeService.sendWelcome(member, config);
    await loggingService.logAction(member.guild, 'Member Bergabung / Member Joined', `${member.user.tag} joined the server.`, {
      user: member.id,
      memberCount: member.guild.memberCount,
    });
  } catch (err) {
    logger.error('guildMemberAdd handling failed', err.message);
  }
}
