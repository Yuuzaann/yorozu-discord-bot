import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../config/defaultConfig.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConfigService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

function deepMerge(base, override) {
  if (typeof override !== 'object' || override === null) return base;
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof base[key] === 'object') {
      result[key] = deepMerge(base[key] ?? {}, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * File-backed per-guild config store. Kept intentionally simple (single
 * JSON file) — swap the read/write internals for a database if needed
 * without changing the public API.
 */
class ConfigService {
  constructor() {
    this.cache = null;
  }

  async _load() {
    if (this.cache) return this.cache;
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
      this.cache = JSON.parse(raw);
    } catch (err) {
      if (err.code === 'ENOENT') {
        this.cache = { guilds: {} };
        await this._save();
      } else {
        logger.error('Failed to load config.json, starting with empty store.', err.message);
        this.cache = { guilds: {} };
      }
    }
    return this.cache;
  }

  async _save() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(CONFIG_PATH, JSON.stringify(this.cache, null, 2), 'utf-8');
  }

  /** Returns the effective (default-merged) config for a guild. */
  async getGuildConfig(guildId) {
    const store = await this._load();
    const override = store.guilds[guildId]?.config ?? {};
    return deepMerge(defaultConfig, override);
  }

  /** Deep-merges `patch` into the guild's stored config overrides and persists it. */
  async updateGuildConfig(guildId, patch) {
    const store = await this._load();
    if (!store.guilds[guildId]) store.guilds[guildId] = {};
    store.guilds[guildId].config = deepMerge(store.guilds[guildId].config ?? {}, patch);
    await this._save();
    return this.getGuildConfig(guildId);
  }

  /** Arbitrary per-guild runtime state (role IDs, channel IDs, ticket counters, etc). */
  async getGuildState(guildId) {
    const store = await this._load();
    return store.guilds[guildId]?.state ?? {};
  }

  async updateGuildState(guildId, patch) {
    const store = await this._load();
    if (!store.guilds[guildId]) store.guilds[guildId] = {};
    store.guilds[guildId].state = { ...(store.guilds[guildId].state ?? {}), ...patch };
    await this._save();
    return store.guilds[guildId].state;
  }

  /** Ticket records keyed by channel ID, stored per guild. */
  async getTickets(guildId) {
    const store = await this._load();
    return store.guilds[guildId]?.tickets ?? {};
  }

  async setTicket(guildId, channelId, ticketData) {
    const store = await this._load();
    if (!store.guilds[guildId]) store.guilds[guildId] = {};
    if (!store.guilds[guildId].tickets) store.guilds[guildId].tickets = {};
    store.guilds[guildId].tickets[channelId] = ticketData;
    await this._save();
  }

  async deleteTicket(guildId, channelId) {
    const store = await this._load();
    if (store.guilds[guildId]?.tickets?.[channelId]) {
      delete store.guilds[guildId].tickets[channelId];
      await this._save();
    }
  }

  /**
   * Bot presence/status is a single Gateway-wide setting shared across every
   * guild the bot is in (Discord bots only have one presence, not one per
   * guild) — stored at the top level of the store, not under `guilds`.
   */
  async getBotStatus() {
    const store = await this._load();
    return store.botStatus ?? null;
  }

  async setBotStatus(status) {
    const store = await this._load();
    store.botStatus = status;
    await this._save();
  }
}

export const configService = new ConfigService();
