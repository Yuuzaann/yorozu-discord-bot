import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { applyStoredStatus } from '../utils/presence.js';
import { statsService } from '../services/statsService.js';

const logger = createLogger('ReadyEvent');

export const name = 'ready';
export const once = true;

export async function execute(client) {
  logger.success(`Logged in as ${client.user.tag}`);

  const status = await configService.getBotStatus();
  applyStoredStatus(client, status);

  statsService.updateAllGuilds(client).catch((err) => logger.error('Initial server stats update failed', err.stack ?? err.message));

  if (process.env.AUTO_SETUP === 'true') {
    logger.info('AUTO_SETUP=true — skipping destructive auto-setup on boot. Run /setup server manually per guild.');
  }
}
