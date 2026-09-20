import { createLogger } from '../utils/logger.js';

const logger = createLogger('GuildCreateEvent');

export const name = 'guildCreate';
export const once = false;

export async function execute(guild) {
  logger.info(`Joined guild: ${guild.name} (${guild.id})`);
  const systemChannel = guild.systemChannel;
  if (systemChannel?.isTextBased()) {
    await systemChannel
      .send(
        '👋 Terima kasih sudah menambahkan bot ini! Administrator dapat menjalankan `/setup preview` untuk melihat struktur server, lalu `/setup server` untuk membangunnya.\n' +
          '👋 Thanks for adding me! An Administrator can run `/setup preview` to see the server structure, then `/setup server` to build it.'
      )
      .catch(() => {});
  }
}
