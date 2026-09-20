import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { SERVER_STRUCTURE } from '../config/serverStructure.js';
import { DEFAULT_RULES } from '../config/rulesContent.js';
import { VOICE_GUIDE } from '../config/voiceGuideContent.js';
import { roleService } from './roleService.js';
import { verificationService } from './verificationService.js';
import { ticketService } from './ticketService.js';
import { configService } from './configService.js';
import { loggingService } from './loggingService.js';
import { createLogger } from '../utils/logger.js';
import { primaryEmbed } from '../utils/embeds.js';

const logger = createLogger('ServerSetup');

const MEMBER_READONLY_DENY = [
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.CreatePublicThreads,
  PermissionFlagsBits.CreatePrivateThreads,
  PermissionFlagsBits.AddReactions,
  PermissionFlagsBits.UseExternalEmojis,
  PermissionFlagsBits.UseExternalStickers,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.MentionEveryone,
];

// Same set as MEMBER_READONLY_DENY, but as the string flag names required by
// PermissionOverwriteManager#edit() (which takes named booleans, not bit values).
const MEMBER_READONLY_DENY_NAMES = [
  'SendMessages',
  'SendMessagesInThreads',
  'CreatePublicThreads',
  'CreatePrivateThreads',
  'AddReactions',
  'UseExternalEmojis',
  'UseExternalStickers',
  'EmbedLinks',
  'AttachFiles',
  'MentionEveryone',
];

const STAFF_ALLOW = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.ReadMessageHistory,
];

/**
 * Guild-scoped lock so two /setup runs can never race on the same guild.
 */
const setupLocks = new Set();

class ServerSetupService {
  isLocked(guildId) {
    return setupLocks.has(guildId);
  }

  lock(guildId) {
    setupLocks.add(guildId);
  }

  unlock(guildId) {
    setupLocks.delete(guildId);
  }

  /** Text-only preview of the structure that /setup server would create. Never mutates the guild. */
  buildPreviewText() {
    const lines = [];
    for (const category of SERVER_STRUCTURE) {
      lines.push(`**${category.name}**${category.readonly ? ' (read-only)' : ''}`);
      for (const channel of category.channels) {
        lines.push(`  ${channel.name}`);
      }
    }
    return lines.join('\n');
  }

  async runFullSetup(guild, config) {
    const report = {
      failedDeletions: [],
      createdCategories: 0,
      createdChannels: 0,
      createdRoles: 0,
      errors: [],
    };

    try {
      // 0. Force temporaryVoice.deleteDelay to 0 on every setup run — instant
      // cleanup of empty temp voice rooms is the standing default for this
      // server template, regardless of any prior override.
      await configService.updateGuildConfig(guild.id, { temporaryVoice: { deleteDelay: 0 } });
      config = await configService.getGuildConfig(guild.id);

      // 1. Cleanup temporary voice (handled by the service's in-memory registry; nothing persistent to wipe here)

      // 2-3. Delete existing channels then categories — fired concurrently
      // (in two phases: channels, then categories) instead of one-by-one so
      // discord.js's REST rate limiter can pipeline the requests instead of
      // us waiting a full round-trip between every single deletion.
      const allChannels = [...guild.channels.cache.values()];
      const nonCategory = allChannels.filter((c) => c.type !== ChannelType.GuildCategory);
      const categories = allChannels.filter((c) => c.type === ChannelType.GuildCategory);

      await Promise.all(
        nonCategory.map(async (channel) => {
          try {
            await channel.delete('Server reset via /setup server');
          } catch (err) {
            report.failedDeletions.push(channel.name);
          }
        })
      );
      await Promise.all(
        categories.map(async (category) => {
          try {
            await category.delete('Server reset via /setup server');
          } catch (err) {
            report.failedDeletions.push(category.name);
          }
        })
      );

      // 5. Create roles
      const { verified, staff, selfRoles } = await roleService.ensureCoreRoles(guild, config);
      report.createdRoles = 1 + 1 + Object.keys(selfRoles).length;

      // 6-8. Create categories, channels, permissions — parallelized as much
      // as the dependency chain allows: all categories at once, then every
      // channel across every category at once (each only needs its own
      // already-created parent category id, not any sibling channel), then
      // permissions per category all at once.
      const createdChannelsByName = {};
      const specialChannels = {};
      const interfaceChannels = [];

      const categoryEntries = await Promise.all(
        SERVER_STRUCTURE.map(async (categoryDef) => {
          try {
            const category = await guild.channels.create({
              name: categoryDef.name,
              type: ChannelType.GuildCategory,
              reason: 'Server setup',
            });
            report.createdCategories += 1;
            return { categoryDef, category };
          } catch (err) {
            report.errors.push(`Failed to create category ${categoryDef.name}: ${err.message}`);
            return { categoryDef, category: null };
          }
        })
      );

      await Promise.all(
        categoryEntries.map(async ({ categoryDef, category }) => {
          if (!category) return;

          const createdInCategory = [];
          await Promise.all(
            categoryDef.channels.map(async (channelDef) => {
              try {
                const created = await guild.channels.create({
                  name: channelDef.name,
                  type: channelDef.type,
                  parent: category.id,
                  reason: 'Server setup',
                });
                createdChannelsByName[channelDef.name] = created;
                createdInCategory.push({ channelDef, channel: created });
                if (channelDef.special) specialChannels[channelDef.special] = created;
                if (channelDef.special === 'interface') interfaceChannels.push(created);
                report.createdChannels += 1;
              } catch (err) {
                report.errors.push(`Failed to create channel ${channelDef.name}: ${err.message}`);
              }
            })
          );

          await this._applyCategoryPermissions(guild, category, categoryDef, { verified, staff }, createdInCategory).catch((err) =>
            report.errors.push(`Permissions failed for ${categoryDef.name}: ${err.message}`)
          );
        })
      );

      // 9-11. Panels — independent of each other, run concurrently.
      await Promise.all([
        specialChannels.verification ? verificationService.ensurePanel(specialChannels.verification) : null,
        // 10. Take-role panel is posted by the roles command/service on demand via /roles setup,
        // but we also seed it here so setup is self-contained.
        specialChannels['take-role'] ? roleService.ensureTakeRolePanel(specialChannels['take-role'], config) : null,
        // 11. Ticket panel
        specialChannels['ticket-panel'] ? ticketService.ensurePanel(specialChannels['ticket-panel'], config) : null,
      ]);

      // 12. Logging is implicit: loggingService looks up channels by name at log time.

      // 13. Temporary voice: trigger channels are already created above (tempVoiceTrigger flag).

      // 14. Post default (or custom) bilingual server rules to the rules channel.
      const postRules = specialChannels.rules
        ? (async () => {
            const rulesEmbed = config.rules.content
              ? primaryEmbed(DEFAULT_RULES.title, config.rules.content)
              : primaryEmbed(DEFAULT_RULES.title, null).addFields(
                  { name: '🇮🇩 Bahasa Indonesia', value: DEFAULT_RULES.id },
                  { name: '🇬🇧 English', value: DEFAULT_RULES.en }
                );
            await specialChannels.rules.send({ embeds: [rulesEmbed] }).catch((err) =>
              report.errors.push(`Failed to post rules: ${err.message}`)
            );
          })()
        : null;

      // 15. Post the full bilingual /voice command guide to every "interface"
      // channel (Game Zone and Voice Public both have one) — sent concurrently.
      const postVoiceGuides =
        interfaceChannels.length > 0
          ? (() => {
              const guideEmbed = primaryEmbed(VOICE_GUIDE.title, VOICE_GUIDE.description)
                .addFields(VOICE_GUIDE.commands.map((c) => ({ name: c.usage, value: `🇮🇩 ${c.id}\n🇬🇧 ${c.en}` })))
                .setFooter({ text: VOICE_GUIDE.footer });
              return Promise.all(
                interfaceChannels.map((interfaceChannel) =>
                  interfaceChannel
                    .send({ embeds: [guideEmbed] })
                    .catch((err) => report.errors.push(`Failed to post voice guide in ${interfaceChannel.name}: ${err.message}`))
                )
              );
            })()
          : null;

      // Ensure the Verified role has full read/write on general (belt-and-braces;
      // already granted at category level, but explicit here in case the
      // channel-level override above ever changes).
      const ensureGeneralAccess = specialChannels.general
        ? specialChannels.general.permissionOverwrites
            .edit(verified, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
            .catch(() => {})
        : null;

      await Promise.all([postRules, postVoiceGuides, ensureGeneralAccess]);

      report.success = true;
    } catch (err) {
      logger.error('Setup failed', err.message);
      report.success = false;
      report.errors.push(err.message);
    }

    return report;
  }

  async _applyCategoryPermissions(guild, category, categoryDef, { verified, staff }, createdInCategory) {
    const everyone = guild.roles.everyone;
    const overwrites = [];

    if (categoryDef.staffOnly) {
      overwrites.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      overwrites.push({ id: staff.id, allow: STAFF_ALLOW });
    } else if (categoryDef.readonly) {
      // Hidden until verified; verified members can view/read but not post
      // (send/embed/attach/thread/react/mention are all denied — section 7 of spec).
      overwrites.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      overwrites.push({ id: verified.id, allow: [PermissionFlagsBits.ViewChannel], deny: MEMBER_READONLY_DENY });
      overwrites.push({ id: staff.id, allow: STAFF_ALLOW });
    } else {
      overwrites.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      overwrites.push({ id: verified.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      overwrites.push({ id: staff.id, allow: STAFF_ALLOW });
    }

    await category.permissionOverwrites.set(overwrites, 'Server setup: category permissions');

    // Channels flagged channelReadonly: only Staff/Admin/Bot can post — regular
    // members (and Verified) can view and use buttons/select menus, but not
    // send messages, embed links, attach files, etc.
    const readonlyChannelEdits = createdInCategory
      .filter(({ channelDef }) => channelDef.channelReadonly)
      .flatMap(({ channel }) => {
        const denyMap = Object.fromEntries(MEMBER_READONLY_DENY_NAMES.map((flagName) => [flagName, false]));
        return [
          channel.permissionOverwrites.edit(everyone, denyMap).catch(() => {}),
          channel.permissionOverwrites.edit(verified, denyMap).catch(() => {}),
        ];
      });

    // Channels flagged unverifiedVisible get an explicit per-channel override so
    // @everyone (unverified included) can see them even though the category
    // itself is hidden by default. Channels flagged unverifiedWritable (general)
    // additionally allow sending/reading history for @everyone.
    const unverifiedVisibleEdits = createdInCategory
      .filter(({ channelDef }) => channelDef.unverifiedVisible)
      .map(({ channelDef, channel }) => {
        if (channelDef.unverifiedWritable) {
          return channel.permissionOverwrites
            .edit(everyone, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true })
            .catch(() => {});
        }
        const denyMap = Object.fromEntries(MEMBER_READONLY_DENY_NAMES.map((flagName) => [flagName, false]));
        return channel.permissionOverwrites.edit(everyone, { ViewChannel: true, ...denyMap }).catch(() => {});
      });

    // Channels flagged hideFromVerifiedRole: the Verified role loses
    // ViewChannel at the channel level (overriding the category-level
    // allow) — used for the verification channel, which should disappear
    // once a member is verified. Staff/Admin keep access since that's a
    // separate role/permission entirely and isn't touched here.
    const hideFromVerifiedEdits = createdInCategory
      .filter(({ channelDef }) => channelDef.hideFromVerifiedRole)
      .map(({ channel }) => channel.permissionOverwrites.edit(verified, { ViewChannel: false }).catch(() => {}));

    await Promise.all([...readonlyChannelEdits, ...unverifiedVisibleEdits, ...hideFromVerifiedEdits]);
  }
}

export const serverSetupService = new ServerSetupService();
