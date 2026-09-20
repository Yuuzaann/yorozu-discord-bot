import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import { DANGEROUS_PERMISSIONS } from '../config/defaultConfig.js';

/** True if the member has Administrator. */
export function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.Administrator);
}

/** True if the guild's bot member can manage roles/channels for setup. */
export function botHasSetupPermissions(guild) {
  const me = guild.members.me;
  if (!me) return false;
  return (
    me.permissions.has(PermissionFlagsBits.ManageChannels) &&
    me.permissions.has(PermissionFlagsBits.ManageRoles)
  );
}

/**
 * Ensures the bot's highest role sits above the target role, so role
 * assignment/removal will succeed. Throws a descriptive error otherwise.
 */
export function assertHierarchy(guild, role) {
  const me = guild.members.me;
  if (!me) throw new Error('Bot member not resolvable in this guild.');
  if (role.position >= me.roles.highest.position) {
    throw new Error(
      `Bot role must be positioned above "${role.name}" to manage it. Move the bot's role higher in Server Settings > Roles.`
    );
  }
}

/** Strips any dangerous permission bits from a permission array/bitfield before applying to a role. */
export function stripDangerousPermissions(permissions) {
  const bitfield = new PermissionsBitField(permissions);
  for (const permName of DANGEROUS_PERMISSIONS) {
    if (PermissionFlagsBits[permName] !== undefined) {
      bitfield.remove(PermissionFlagsBits[permName]);
    }
  }
  return bitfield;
}

/** Guard used by self-role / ticket / voice systems: never let these paths grant dangerous perms. */
export function assertSafeRoleGrant(role) {
  const perms = role.permissions;
  for (const permName of DANGEROUS_PERMISSIONS) {
    const bit = PermissionFlagsBits[permName];
    if (bit !== undefined && perms.has(bit)) {
      throw new Error(`Refusing to grant role "${role.name}": it carries the dangerous permission ${permName}.`);
    }
  }
}

/**
 * True if the interacting user is the bot application's owner (or, for
 * team-owned applications, a member of the owning team). Used for bot-wide
 * settings like presence/status, which affect every server the bot is in —
 * not something any single server's Administrator should control.
 */
export async function isBotOwner(interaction) {
  const app = interaction.client.application;
  if (!app.owner) await app.fetch().catch(() => {});
  if (!app.owner) return false;
  if (app.owner.members) return app.owner.members.has(interaction.user.id); // team-owned
  return app.owner.id === interaction.user.id;
}
