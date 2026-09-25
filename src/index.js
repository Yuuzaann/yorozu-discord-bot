import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from './utils/logger.js';
import { temporaryVoiceService } from './services/temporaryVoiceService.js';
import { statsService } from './services/statsService.js';

const logger = createLogger('Bootstrap');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.DISCORD_TOKEN) {
  logger.error('DISCORD_TOKEN is missing from .env. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

client.commands = new Collection();

const deps = { temporaryVoiceService, commands: client.commands };

async function loadCommands() {
  const commandsDir = path.join(__dirname, 'commands');
  const files = readdirSync(commandsDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    if (mod.data?.name) {
      client.commands.set(mod.data.name, mod);
    }
  }
  logger.info(`Loaded ${client.commands.size} command modules.`);
}

async function loadEvents() {
  const eventsDir = path.join(__dirname, 'events');
  const files = readdirSync(eventsDir).filter((f) => f.endsWith('.js'));
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(eventsDir, file)).href);
    if (!mod.name || !mod.execute) continue;
    if (mod.once) {
      client.once(mod.name, (...args) => mod.execute(...args, deps));
    } else {
      client.on(mod.name, (...args) => mod.execute(...args, deps));
    }
  }
  logger.info(`Loaded ${files.length} event modules.`);
}

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled promise rejection', err?.stack ?? err?.message ?? err);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception (bot stays alive)', err?.stack ?? err?.message ?? err);
});

async function bootstrap() {
  await loadCommands();
  await loadEvents();
  await client.login(process.env.DISCORD_TOKEN);

  // Refresh Server Stats channel names every 10 minutes — matches Discord's
  // hard rate limit of 2 channel-name edits per 10 minutes per channel, so
  // this is the fastest safe cadence, not an arbitrary choice.
  setInterval(() => {
    statsService.updateAllGuilds(client).catch((err) => logger.error('Server stats update failed', err.stack ?? err.message));
  }, 10 * 60 * 1000);
}

bootstrap().catch((err) => {
  logger.error('Fatal bootstrap error', err.stack ?? err.message);
  process.exit(1);
});
