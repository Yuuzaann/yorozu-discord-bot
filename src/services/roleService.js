import { ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import { assertHierarchy, assertSafeRoleGrant } from '../utils/permissions.js';
import { normalizeName } from '../utils/normalize.js';
import { primaryEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { configService } from './configService.js';

const logger = createLogger('RoleService');

export const ROLE_SELECT_ID = 'role_select';

// One-time cleanup list: labels that used to be in the default self-role
// config but no longer are. Any role matching one of these names is removed
// automatically the next time roles are (re)generated, as long as it isn't
// also present in the *current* selfRoles.options list (safety check).
// 'Member' used to be in this list but is now a real core role (config.roles.member), so it
// must never be pruned; core role names are additionally protected inside pruneObsoleteSelfRoles.
const LEGACY_SELF_ROLE_LABELS = ['Otaku', 'Dev'];

class RoleService {
  /** Finds a role by loosely-normalized name (case/space/emoji-insensitive). Null if none matches. */
  findByLabel(guild, label) {
    const target = normalizeName(label);
    // Managed roles belong to bots/integrations and can't be assigned — never treat them as ours.
    return guild.roles.cache.find((r) => !r.managed && normalizeName(r.name) === target) ?? null;
  }

  /** Finds an existing role by (normalized) name, or creates it. Never duplicates. */
  async ensureRole(guild, name, options = {}) {
    const existing = this.findByLabel(guild, name);
    if (existing) {
      if (options.enforceHoist && existing.hoist !== options.hoist) {
        await existing.setHoist(options.hoist, 'Bot setup: role display setting').catch((err) => logger.warn(`Failed to set hoist on "${existing.name}"`, err.message));
      }
      return existing;
    }
    const role = await guild.roles.create({
      name,
      mentionable: false,
      hoist: options.hoist ?? false,
      color: options.color,
      permissions: [],
      reason: 'Bot setup: ensure required role exists',
    });
    logger.info(`Created role "${name}" in ${guild.name}`);
    return role;
  }

  /**
   * Deletes self-roles that are no longer part of the configured list.
   * Two mechanisms, both scoped to safe (no dangerous-permission) roles:
   *  1. Tracked cleanup — roles this bot created as self-roles before,
   *     recorded by option id in guild state, whose option id no longer
   *     exists in config.selfRoles.options.
   *  2. Legacy-name cleanup — a fixed list of labels from an older default
   *     config (Member/Otaku/Dev) that may exist untracked from before this
   *     tracking was added. Skipped if that label is still in the current
   *     config (so it's never deleted right after being (re)created).
   */
  async pruneObsoleteSelfRoles(guild, config) {
    const currentLabels = new Set(config.selfRoles.options.map((o) => normalizeName(o.label)));
    const protectedLabels = new Set(
      [config.verification.roleName, config.setup?.staffRoleName ?? 'Staff', config.roles.member.name, config.roles.bot.name, config.roles.musicBot.name].map(normalizeName)
    );
    const state = await configService.getGuildState(guild.id);
    const trackedIds = state.selfRoleIds ?? {};
    const currentOptionIds = new Set(config.selfRoles.options.map((o) => o.id));

    // Member lists are needed to tell an unused legacy role from one people still hold.
    if (guild.members.cache.size < guild.memberCount) {
      await guild.members.fetch().catch(() => {});
    }

    const toDelete = new Map(); // roleId -> role

    for (const [optionId, roleId] of Object.entries(trackedIds)) {
      if (currentOptionIds.has(optionId)) continue;
      const role = guild.roles.cache.get(roleId);
      if (role) toDelete.set(role.id, role);
    }

    for (const label of LEGACY_SELF_ROLE_LABELS) {
      if (currentLabels.has(normalizeName(label)) || protectedLabels.has(normalizeName(label))) continue; // still configured / core role, don't touch
      const role = this.findByLabel(guild, label);
      // Name-based matching is a guess — never delete a managed (bot/integration) role or one members still hold.
      if (role && !role.managed && role.members.size === 0) toDelete.set(role.id, role);
    }

    const deletions = [...toDelete.values()].map(async (role) => {
      try {
        assertSafeRoleGrant(role); // refuse to auto-delete anything carrying dangerous permissions, just in case
        await role.delete('Self-role cleanup: no longer in configured self-role list');
        logger.info(`Deleted obsolete self-role "${role.name}" in ${guild.name}`);
      } catch (err) {
        logger.warn(`Failed to delete obsolete self-role "${role.name}"`, err.message);
      }
    });
    await Promise.all(deletions);
  }

  /** Ensures Verified, Staff, Member, Bot, Bot Musik and all configurable self-roles exist. */
  async ensureCoreRoles(guild, config) {
    const rc = config.roles;
    const core = (cfg) =>
      cfg.enabled ? this.ensureRole(guild, cfg.name, { hoist: cfg.hoist, color: cfg.color, enforceHoist: true }) : null;

    const [verified, staff, member, bot, musicBot] = await Promise.all([
      this.ensureRole(guild, config.verification.roleName, { hoist: false }),
      this.ensureRole(guild, config.setup?.staffRoleName ?? 'Staff', { hoist: true, color: 0x5865f2 }),
      core(rc.member),
      core(rc.bot),
      core(rc.musicBot),
    ]);

    await this.pruneObsoleteSelfRoles(guild, config);

    const selfRoleResults = await Promise.all(
      config.selfRoles.options.map(async (option) => ({
        option,
        role: await this.ensureRole(guild, option.label, { color: option.color }),
      }))
    );

    const selfRoles = {};
    const trackedIds = {};
    for (const { option, role } of selfRoleResults) {
      selfRoles[option.id] = role;
      trackedIds[option.id] = role.id;
    }
    await configService.updateGuildState(guild.id, { selfRoleIds: trackedIds });

    return { verified, staff, selfRoles, member, bot, musicBot };
  }

  /** Looks up the Member/Bot/Bot Musik roles (null for disabled or missing ones), refetching roles once if any is missing. */
  async resolveAutoRoles(guild, config) {
    const lookup = () => {
      const find = (cfg) => (cfg.enabled ? this.findByLabel(guild, cfg.name) : null);
      return { member: find(config.roles.member), bot: find(config.roles.bot), musicBot: find(config.roles.musicBot) };
    };
    let roles = lookup();
    const missing = ['member', 'bot', 'musicBot'].some((k) => config.roles[k].enabled && !roles[k]);
    if (missing) {
      await guild.roles.fetch().catch(() => {});
      roles = lookup();
    }
    return roles;
  }

  /** True if this bot member should get Bot Musik instead of Bot. */
  isMusicBot(member, config) {
    const cfg = config.roles.musicBot;
    if (cfg.excludeIds?.includes(member.id)) return false;
    if (cfg.botIds?.includes(member.id)) return true;
    const haystack = normalizeName(`${member.user.username} ${member.displayName ?? ''}`);
    return (cfg.nameHints ?? []).some((hint) => {
      const needle = normalizeName(hint);
      return needle.length > 0 && haystack.includes(needle);
    });
  }

  /** Gives a bot member the Bot or Bot Musik role. Leaves bots that already hold either role alone. */
  async applyBotRole(member, config, roles = null) {
    if (!member.user.bot) return { changed: false };
    roles ??= await this.resolveAutoRoles(member.guild, config);
    if ((roles.bot && member.roles.cache.has(roles.bot.id)) || (roles.musicBot && member.roles.cache.has(roles.musicBot.id))) {
      return { changed: false };
    }
    const target = this.isMusicBot(member, config) && roles.musicBot ? roles.musicBot : roles.bot;
    if (!target) return { changed: false };
    assertSafeRoleGrant(target);
    assertHierarchy(member.guild, target);
    await member.roles.add(target, `Auto role: ${target.name}`);
    return { changed: true, role: target };
  }

  /** Gives a human member the Member role (used after verification, or on join when verification is off). */
  async grantMemberRole(member, config, role = null) {
    if (!config.roles.member.enabled || member.user.bot) return { granted: false };
    role ??= (await this.resolveAutoRoles(member.guild, config)).member;
    if (!role || member.roles.cache.has(role.id)) return { granted: false };
    assertSafeRoleGrant(role);
    assertHierarchy(member.guild, role);
    await member.roles.add(role, 'Auto role: Member');
    return { granted: true };
  }

  /**
   * Catches up everyone already in the server: bots get Bot / Bot Musik, verified humans get Member
   * (every human when verification is disabled). Never removes roles.
   */
  async syncAutoRoles(guild, config) {
    const result = { bots: 0, members: 0, failed: 0, firstError: null };
    const roles = await this.resolveAutoRoles(guild, config);
    if (!roles.member && !roles.bot && !roles.musicBot) return result;

    await guild.members.fetch().catch(() => {});
    const verifiedRole = this.findByLabel(guild, config.verification.roleName);

    for (const member of guild.members.cache.values()) {
      try {
        if (member.user.bot) {
          if ((await this.applyBotRole(member, config, roles)).changed) result.bots += 1;
        } else if (roles.member) {
          const eligible = config.verification.enabled === false || (verifiedRole && member.roles.cache.has(verifiedRole.id));
          if (eligible && (await this.grantMemberRole(member, config, roles.member)).granted) result.members += 1;
        }
      } catch (err) {
        result.failed += 1;
        result.firstError ??= err.message;
      }
    }
    if (result.firstError) logger.warn(`syncAutoRoles had ${result.failed} failure(s) in ${guild.name}`, result.firstError);
    return result;
  }

  /** Marks a bot as music bot (or not), remembers the choice in config, and swaps its role. */
  async setMusicBot(member, config, enabled) {
    const cfg = config.roles.musicBot;
    const botIds = new Set(cfg.botIds ?? []);
    const excludeIds = new Set(cfg.excludeIds ?? []);
    if (enabled) {
      botIds.add(member.id);
      excludeIds.delete(member.id);
    } else {
      botIds.delete(member.id);
      excludeIds.add(member.id);
    }
    await configService.updateGuildConfig(member.guild.id, {
      roles: { musicBot: { botIds: [...botIds], excludeIds: [...excludeIds] } },
    });

    const roles = await this.resolveAutoRoles(member.guild, config);
    const add = enabled ? roles.musicBot : roles.bot;
    const remove = enabled ? roles.bot : roles.musicBot;
    if (add && !member.roles.cache.has(add.id)) {
      assertSafeRoleGrant(add);
      assertHierarchy(member.guild, add);
      await member.roles.add(add, 'Music bot flag changed');
    }
    if (remove && member.roles.cache.has(remove.id)) {
      await member.roles.remove(remove, 'Music bot flag changed').catch(() => {});
    }
    return { role: add ?? null };
  }

  /** Toggles a whitelisted self-role on a member. Refuses dangerous roles and bad hierarchy. */
  async toggleSelfRole(member, role) {
    assertSafeRoleGrant(role);
    assertHierarchy(member.guild, role);
    const has = member.roles.cache.has(role.id);
    if (has) {
      await member.roles.remove(role, 'Self-role toggle: remove');
      return { added: false };
    }
    await member.roles.add(role, 'Self-role toggle: add');
    return { added: true };
  }

  async addVerifiedRole(member, verifiedRole) {
    assertHierarchy(member.guild, verifiedRole);
    if (member.roles.cache.has(verifiedRole.id)) return { alreadyVerified: true };
    await member.roles.add(verifiedRole, 'User verification');
    return { alreadyVerified: false };
  }

  buildTakeRolePanel(config) {
    const embed = primaryEmbed(
      biTitle('🎭 Take Role', 'Take Role'),
      bi(
        'Pilih satu atau beberapa role sekaligus dari menu di bawah.',
        'Pick one or more roles at once from the menu below.'
      )
    );
    const menu = new StringSelectMenuBuilder()
      .setCustomId(ROLE_SELECT_ID)
      .setPlaceholder('Pilih role (bisa lebih dari satu) / Pick role(s)')
      .setMinValues(1)
      .setMaxValues(config.selfRoles.options.length)
      .addOptions(config.selfRoles.options.map((o) => ({ label: o.label, value: o.id, emoji: o.emoji })));
    const row = new ActionRowBuilder().addComponents(menu);
    return { embeds: [embed], components: [row] };
  }

  /** Posts the take-role panel, avoiding duplicates. */
  async ensureTakeRolePanel(channel, config) {
    const messages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
    const existing = messages?.find(
      (m) => m.author.id === channel.client.user.id && m.components?.[0]?.components?.[0]?.customId === ROLE_SELECT_ID
    );
    if (existing) {
      // Keep the menu in sync with the current self-role options.
      await existing.edit(this.buildTakeRolePanel(config)).catch(() => {});
      return existing;
    }
    return channel.send(this.buildTakeRolePanel(config));
  }
}

export const roleService = new RoleService();
