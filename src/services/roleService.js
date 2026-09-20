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
const LEGACY_SELF_ROLE_LABELS = ['Member', 'Otaku', 'Dev'];

class RoleService {
  /** Finds a role by loosely-normalized name (case/space/emoji-insensitive). Null if none matches. */
  findByLabel(guild, label) {
    const target = normalizeName(label);
    return guild.roles.cache.find((r) => normalizeName(r.name) === target) ?? null;
  }

  /** Finds an existing role by (normalized) name, or creates it. Never duplicates. */
  async ensureRole(guild, name, options = {}) {
    const existing = this.findByLabel(guild, name);
    if (existing) return existing;
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
    const state = await configService.getGuildState(guild.id);
    const trackedIds = state.selfRoleIds ?? {};
    const currentOptionIds = new Set(config.selfRoles.options.map((o) => o.id));

    const toDelete = new Map(); // roleId -> role

    for (const [optionId, roleId] of Object.entries(trackedIds)) {
      if (currentOptionIds.has(optionId)) continue;
      const role = guild.roles.cache.get(roleId);
      if (role) toDelete.set(role.id, role);
    }

    for (const label of LEGACY_SELF_ROLE_LABELS) {
      if (currentLabels.has(normalizeName(label))) continue; // still configured, don't touch
      const role = this.findByLabel(guild, label);
      if (role) toDelete.set(role.id, role);
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

  /** Ensures the Verified role and all configurable self-roles exist. */
  async ensureCoreRoles(guild, config) {
    const [verified, staff] = await Promise.all([
      this.ensureRole(guild, config.verification.roleName, { hoist: false }),
      this.ensureRole(guild, 'Staff', { hoist: true, color: 0x5865f2 }),
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

    return { verified, staff, selfRoles };
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
    if (existing) return existing;
    return channel.send(this.buildTakeRolePanel(config));
  }
}

export const roleService = new RoleService();
