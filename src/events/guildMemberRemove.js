import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { welcomeService } from '../services/welcomeService.js';
import { loggingService } from '../services/loggingService.js';

const logger = createLogger('GuildMemberRemoveEvent');

export const name = 'guildMemberRemove';
export const once = false;

export async function execute(member) {
  try {
    const config = await configService.getGuildConfig(member.guild.id);
    await welcomeService.sendGoodbye(member, config);
    await loggingService.logAction(member.guild, 'Member Keluar / Member Left', `${member.user.tag} left the server.`, {
      user: member.id,
      memberCount: member.guild.memberCount,
    });
  } catch (err) {
    logger.error('guildMemberRemove handling failed', err.message);
  }
}
