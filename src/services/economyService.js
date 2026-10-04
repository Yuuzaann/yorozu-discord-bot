import { configService } from './configService.js';
import { assertSafeRoleGrant } from '../utils/permissions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_STREAK_CAP_DAYS = 30;

function isPositiveInt(n) {
  return Number.isSafeInteger(n) && n > 0;
}

/**
 * All amounts are plain integers (no decimals) of the guild's configured
 * virtual currency — never real money, nothing here touches payment
 * processing of any kind. Every account is created lazily on first use with
 * `economy.startingBalance` in the wallet.
 *
 * Every public method runs inside a single FIFO lock. Each operation is a
 * read-modify-write with awaits in between, so without the lock two
 * simultaneous commands (e.g. two /economy pay clicks) could both pass the
 * balance check and spend the same coins twice.
 */
class EconomyService {
  constructor() {
    this._queue = Promise.resolve();
  }

  _locked(fn) {
    const run = this._queue.then(() => fn());
    this._queue = run.catch(() => {});
    return run;
  }

  async _getUser(guildId, userId, config) {
    const existing = await configService.getEconomyUser(guildId, userId);
    if (existing) return existing;
    const fresh = {
      wallet: config.economy.startingBalance,
      bank: 0,
      lastDaily: 0,
      dailyStreak: 0,
      lastWork: 0,
      inventory: [],
    };
    await configService.setEconomyUser(guildId, userId, fresh);
    return fresh;
  }

  /** Returns { wallet, bank, ... } for a member, creating their account if needed. */
  getAccount(guildId, userId, config) {
    return this._locked(() => this._getUser(guildId, userId, config));
  }

  /** Transfers coins from one member's wallet to another's. Never lets a payer go negative. */
  transfer(guildId, fromId, toId, amount, config) {
    return this._locked(async () => {
      if (!isPositiveInt(amount) || fromId === toId) return { success: false, reason: 'invalid' };
      const from = await this._getUser(guildId, fromId, config);
      if (from.wallet < amount) return { success: false, reason: 'insufficient' };

      const to = await this._getUser(guildId, toId, config);
      from.wallet -= amount;
      to.wallet += amount;
      await configService.setEconomyUser(guildId, fromId, from);
      await configService.setEconomyUser(guildId, toId, to);
      return { success: true };
    });
  }

  deposit(guildId, userId, amount, config) {
    return this._locked(async () => {
      if (!isPositiveInt(amount)) return { success: false, reason: 'invalid' };
      const user = await this._getUser(guildId, userId, config);
      if (amount > user.wallet) return { success: false, reason: 'insufficient' };
      user.wallet -= amount;
      user.bank += amount;
      await configService.setEconomyUser(guildId, userId, user);
      return { success: true, user };
    });
  }

  withdraw(guildId, userId, amount, config) {
    return this._locked(async () => {
      if (!isPositiveInt(amount)) return { success: false, reason: 'invalid' };
      const user = await this._getUser(guildId, userId, config);
      if (amount > user.bank) return { success: false, reason: 'insufficient' };
      user.bank -= amount;
      user.wallet += amount;
      await configService.setEconomyUser(guildId, userId, user);
      return { success: true, user };
    });
  }

  /** Once per real day (rolling 24h window). Consecutive-day streak adds a bonus, capped at 30 days. */
  claimDaily(guildId, userId, config) {
    return this._locked(async () => {
      const user = await this._getUser(guildId, userId, config);
      const now = Date.now();
      const sinceLast = now - user.lastDaily;

      if (user.lastDaily && sinceLast < DAY_MS) {
        return { success: false, reason: 'cooldown', remainingMs: DAY_MS - sinceLast };
      }

      const withinStreakWindow = user.lastDaily && sinceLast < DAY_MS * 2;
      user.dailyStreak = withinStreakWindow ? Math.min(user.dailyStreak + 1, DAILY_STREAK_CAP_DAYS) : 1;

      const bonus = (user.dailyStreak - 1) * config.economy.dailyStreakBonus;
      const amount = config.economy.dailyAmount + bonus;
      user.wallet += amount;
      user.lastDaily = now;
      await configService.setEconomyUser(guildId, userId, user);
      return { success: true, amount, streak: user.dailyStreak };
    });
  }

  /** A cooldown-gated random payout, configurable min/max/cooldown. */
  work(guildId, userId, config) {
    return this._locked(async () => {
      const user = await this._getUser(guildId, userId, config);
      const now = Date.now();
      const cooldownMs = config.economy.workCooldownMinutes * 60 * 1000;
      const sinceLast = now - user.lastWork;

      if (user.lastWork && sinceLast < cooldownMs) {
        return { success: false, reason: 'cooldown', remainingMs: cooldownMs - sinceLast };
      }

      // Tolerate a misconfigured min > max instead of paying out negative/NaN amounts.
      const min = Math.min(config.economy.workMinAmount, config.economy.workMaxAmount);
      const max = Math.max(config.economy.workMinAmount, config.economy.workMaxAmount);
      const amount = Math.floor(Math.random() * (max - min + 1)) + min;
      user.wallet += amount;
      user.lastWork = now;
      await configService.setEconomyUser(guildId, userId, user);
      return { success: true, amount };
    });
  }

  /** Top N members by wallet+bank total. */
  async leaderboard(guildId, limit = 10) {
    const users = await configService.getAllEconomyUsers(guildId);
    return Object.entries(users)
      .map(([userId, data]) => ({ userId, total: (data.wallet ?? 0) + (data.bank ?? 0) }))
      .sort((a, b) => b.total - a.total)
      .slice(0, limit);
  }

  /**
   * Buys a configured shop item. If the item has a roleId, grants that role
   * after passing it through the same dangerous-permission guard used
   * everywhere else in the bot — a shop item can never hand out
   * Administrator or similar, even if misconfigured.
   *
   * The role is granted BEFORE any coins are taken, and coins are only
   * deducted if the grant really succeeded — a failed role grant never
   * costs the buyer anything.
   */
  buyItem(guildId, userId, itemId, config, guild) {
    return this._locked(async () => {
      const item = config.economy.shop.find((i) => i.id === itemId);
      if (!item) return { success: false, reason: 'not_found' };

      const user = await this._getUser(guildId, userId, config);
      if (user.inventory.includes(itemId)) return { success: false, reason: 'already_owned' };
      if (user.wallet < item.price) return { success: false, reason: 'insufficient' };

      if (item.roleId) {
        const role = guild.roles.cache.get(item.roleId);
        if (!role) return { success: false, reason: 'role_missing' };
        try {
          assertSafeRoleGrant(role);
        } catch {
          return { success: false, reason: 'unsafe_role' };
        }
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) return { success: false, reason: 'role_failed' };
        try {
          await member.roles.add(role, `Economy shop purchase: ${item.name}`);
        } catch {
          return { success: false, reason: 'role_failed' };
        }
      }

      user.wallet -= item.price;
      user.inventory.push(itemId);
      await configService.setEconomyUser(guildId, userId, user);
      return { success: true, item };
    });
  }

  /** Admin tools: directly credit, debit, or wipe an account. */
  adminGive(guildId, userId, amount, config) {
    return this._locked(async () => {
      const user = await this._getUser(guildId, userId, config);
      user.wallet += amount;
      await configService.setEconomyUser(guildId, userId, user);
      return user;
    });
  }

  adminTake(guildId, userId, amount, config) {
    return this._locked(async () => {
      const user = await this._getUser(guildId, userId, config);
      user.wallet = Math.max(0, user.wallet - amount);
      await configService.setEconomyUser(guildId, userId, user);
      return user;
    });
  }

  adminReset(guildId, userId, config) {
    return this._locked(async () => {
      const fresh = { wallet: config.economy.startingBalance, bank: 0, lastDaily: 0, dailyStreak: 0, lastWork: 0, inventory: [] };
      await configService.setEconomyUser(guildId, userId, fresh);
      return fresh;
    });
  }
}

export const economyService = new EconomyService();
