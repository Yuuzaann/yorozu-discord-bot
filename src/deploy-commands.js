import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createLogger } from './utils/logger.js';

const logger = createLogger('DeployCommands');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadCommands() {
  const commandsDir = path.join(__dirname, 'commands');
  const files = readdirSync(commandsDir).filter((f) => f.endsWith('.js'));
  const commands = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(path.join(commandsDir, file)).href);
    if (mod.data) commands.push(mod.data.toJSON());
  }
  return commands;
}

async function main() {
  const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
  if (!DISCORD_TOKEN || !CLIENT_ID) {
    logger.error('DISCORD_TOKEN and CLIENT_ID must be set in .env before deploying commands.');
    process.exit(1);
  }

  const commands = await loadCommands();
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
      logger.success(`Registered ${commands.length} guild commands for GUILD_ID=${GUILD_ID}.`);
    } else {
      await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
      logger.success(`Registered ${commands.length} global commands (may take up to 1 hour to propagate).`);
    }
  } catch (err) {
    logger.error('Failed to deploy commands', err.message);
    process.exit(1);
  }
}

main();
