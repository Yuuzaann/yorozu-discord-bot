import { createLogger } from '../utils/logger.js';
import { configService } from '../services/configService.js';
import { applyStoredStatus } from '../utils/presence.js';
import { statsService } from '../services/statsService.js';
import { temporaryVoiceService } from '../services/temporaryVoiceService.js';

const logger = createLogger('ReadyEvent');

// discord.js >= 14.22 renamed 'ready' to 'clientReady' ('ready' is deprecated and removed in v15).
export const name = 'clientReady';
export const once = true;

export async function execute(client) {
  logger.success(`Logged in as ${client.user.tag}`);

  const status = await configService.getBotStatus();
  applyStoredStatus(client, status);

  temporaryVoiceService.sweepOrphans(client).catch((err) => logger.error('Temp voice orphan sweep failed', err.stack ?? err.message));

  statsService.updateAllGuilds(client).catch((err) => logger.error('Initial server stats update failed', err.stack ?? err.message));

  if (process.env.AUTO_SETUP === 'true') {
    logger.info('AUTO_SETUP=true — skipping destructive auto-setup on boot. Run /setup server manually per guild.');
  }
}
