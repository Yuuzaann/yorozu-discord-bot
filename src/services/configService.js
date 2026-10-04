import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultConfig } from '../config/defaultConfig.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('ConfigService');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../../data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// Keys that must never be merged from user-supplied patches (prototype pollution guard).
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (typeof override !== 'object' || override === null) return base;
  const result = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (isPlainObject(value)) {
      result[key] = deepMerge(isPlainObject(base?.[key]) ? base[key] : {}, value);
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
 *
 * Writes are serialized through a promise chain and written atomically
 * (temp file + rename), so two concurrent interactions can never interleave
 * writes and leave a half-written / corrupt config.json behind.
 */
class ConfigService {
  constructor() {
    this.cache = null;
    this.loadPromise = null;
    this.saveChain = Promise.resolve();
  }

  async _load() {
    if (this.cache) return this.cache;
    if (!this.loadPromise) this.loadPromise = this._loadFromDisk();
    return this.loadPromise;
  }

  async _loadFromDisk() {
    try {
      await fs.mkdir(DATA_DIR, { recursive: true });
      const raw = await fs.readFile(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      this.cache = isPlainObject(parsed) ? parsed : { guilds: {} };
      if (!isPlainObject(this.cache.guilds)) this.cache.guilds = {};
    } catch (err) {
      this.cache = { guilds: {} };
      if (err.code === 'ENOENT') {
        await this._save();
      } else {
        // Don't silently overwrite a corrupt file on the next save — keep a copy so data can be recovered by hand.
        const backupPath = `${CONFIG_PATH}.corrupt-${Date.now()}`;
        await fs.copyFile(CONFIG_PATH, backupPath).catch(() => {});
        logger.error(`Failed to load config.json (backup saved to ${path.basename(backupPath)}), starting with empty store.`, err.message);
      }
    }
    return this.cache;
  }

  _save() {
    this.saveChain = this.saveChain
      .then(async () => {
        await fs.mkdir(DATA_DIR, { recursive: true });
        const tmpPath = `${CONFIG_PATH}.tmp`;
        await fs.writeFile(tmpPath, JSON.stringify(this.cache, null, 2), 'utf-8');
        await fs.rename(tmpPath, CONFIG_PATH);
      })
      .catch((err) => {
        logger.error('Failed to save config.json', err.message);
      });
    return this.saveChain;
  }

  /** Returns the effective (default-merged) config for a guild. Always a deep copy — callers may mutate it freely. */
  async getGuildConfig(guildId) {
    const store = await this._load();
    const override = store.guilds[guildId]?.config ?? {};
    return structuredClone(deepMerge(defaultConfig, override));
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

  /** Economy account for one member of one guild, or null if they've never had one created. */
  async getEconomyUser(guildId, userId) {
    const store = await this._load();
    return store.guilds[guildId]?.economy?.users?.[userId] ?? null;
  }

  /** Every economy account in a guild, keyed by user ID — used for the leaderboard. */
  async getAllEconomyUsers(guildId) {
    const store = await this._load();
    return store.guilds[guildId]?.economy?.users ?? {};
  }

  async setEconomyUser(guildId, userId, data) {
    const store = await this._load();
    if (!store.guilds[guildId]) store.guilds[guildId] = {};
    if (!store.guilds[guildId].economy) store.guilds[guildId].economy = { users: {} };
    if (!store.guilds[guildId].economy.users) store.guilds[guildId].economy.users = {};
    store.guilds[guildId].economy.users[userId] = data;
    await this._save();
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
