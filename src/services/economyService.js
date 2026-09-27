import { configService } from './configService.js';
import { assertSafeRoleGrant } from '../utils/permissions.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_STREAK_CAP_DAYS = 30;

/**
 * All amounts are plain integers (no decimals) of the guild's configured
 * virtual currency — never real money, nothing here touches payment
 * processing of any kind. Every account is created lazily on first use with
 * `economy.startingBalance` in the wallet.
 */
class EconomyService {
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
  async getAccount(guildId, userId, config) {
    return this._getUser(guildId, userId, config);
  }

  /** Transfers coins from one member's wallet to another's. Never lets a payer go negative. */
  async transfer(guildId, fromId, toId, amount, config) {
    const from = await this._getUser(guildId, fromId, config);
    if (from.wallet < amount) return { success: false, reason: 'insufficient' };

    const to = await this._getUser(guildId, toId, config);
    from.wallet -= amount;
    to.wallet += amount;
    await configService.setEconomyUser(guildId, fromId, from);
    await configService.setEconomyUser(guildId, toId, to);
    return { success: true };
  }

  async deposit(guildId, userId, amount, config) {
    const user = await this._getUser(guildId, userId, config);
    if (amount > user.wallet) return { success: false, reason: 'insufficient' };
    user.wallet -= amount;
    user.bank += amount;
    await configService.setEconomyUser(guildId, userId, user);
    return { success: true, user };
  }

  async withdraw(guildId, userId, amount, config) {
    const user = await this._getUser(guildId, userId, config);
    if (amount > user.bank) return { success: false, reason: 'insufficient' };
    user.bank -= amount;
    user.wallet += amount;
    await configService.setEconomyUser(guildId, userId, user);
    return { success: true, user };
  }

  /** Once per real day (rolling 24h window). Consecutive-day streak adds a bonus, capped at 30 days. */
  async claimDaily(guildId, userId, config) {
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
  }

  /** A cooldown-gated random payout, configurable min/max/cooldown. */
  async work(guildId, userId, config) {
    const user = await this._getUser(guildId, userId, config);
    const now = Date.now();
    const cooldownMs = config.economy.workCooldownMinutes * 60 * 1000;
    const sinceLast = now - user.lastWork;

    if (user.lastWork && sinceLast < cooldownMs) {
      return { success: false, reason: 'cooldown', remainingMs: cooldownMs - sinceLast };
    }

    const { workMinAmount, workMaxAmount } = config.economy;
    const amount = Math.floor(Math.random() * (workMaxAmount - workMinAmount + 1)) + workMinAmount;
    user.wallet += amount;
    user.lastWork = now;
    await configService.setEconomyUser(guildId, userId, user);
    return { success: true, amount };
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
   */
  async buyItem(guildId, userId, itemId, config, guild) {
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
      if (member) await member.roles.add(role, `Economy shop purchase: ${item.name}`).catch(() => {});
    }

    user.wallet -= item.price;
    user.inventory.push(itemId);
    await configService.setEconomyUser(guildId, userId, user);
    return { success: true, item };
  }

  /** Admin tools: directly credit, debit, or wipe an account. */
  async adminGive(guildId, userId, amount, config) {
    const user = await this._getUser(guildId, userId, config);
    user.wallet += amount;
    await configService.setEconomyUser(guildId, userId, user);
    return user;
  }

  async adminTake(guildId, userId, amount, config) {
    const user = await this._getUser(guildId, userId, config);
    user.wallet = Math.max(0, user.wallet - amount);
    await configService.setEconomyUser(guildId, userId, user);
    return user;
  }

  async adminReset(guildId, userId, config) {
    const fresh = { wallet: config.economy.startingBalance, bank: 0, lastDaily: 0, dailyStreak: 0, lastWork: 0, inventory: [] };
    await configService.setEconomyUser(guildId, userId, fresh);
    return fresh;
  }
}

export const economyService = new EconomyService();
