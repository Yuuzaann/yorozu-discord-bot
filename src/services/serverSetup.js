import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { SERVER_STRUCTURE } from '../config/serverStructure.js';
import { DEFAULT_RULES } from '../config/rulesContent.js';
import { VOICE_GUIDE } from '../config/voiceGuideContent.js';
import { roleService } from './roleService.js';
import { verificationService } from './verificationService.js';
import { ticketService } from './ticketService.js';
import { statsService } from './statsService.js';
import { communityService } from './communityService.js';
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

// Bots hold no Verified role, so without their own overwrites they could not even see the channels.
// Bot: read/post everywhere except the stats and staff-only categories.
// Bot Musik: same, plus voice (Connect/Speak) so music bots can join the voice channels.
const BOT_ALLOW_NAMES = ['ViewChannel', 'SendMessages', 'SendMessagesInThreads', 'EmbedLinks', 'AttachFiles', 'ReadMessageHistory', 'AddReactions', 'UseExternalEmojis'];
const MUSIC_BOT_ALLOW_NAMES = [...BOT_ALLOW_NAMES, 'Connect', 'Speak', 'UseVAD'];
const toBits = (names) => names.map((n) => PermissionFlagsBits[n]);
const toNamedMap = (names) => Object.fromEntries(names.map((n) => [n, true]));

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
    lines.push('');
    lines.push('**Roles**');
    lines.push('  Staff, Verified, Member (display on), Bot (display on), Bot Musik (display on) + self-roles');
    lines.push('**Community & Onboarding**');
    lines.push('  Enable Community (rules + updates channel), Discord onboarding if eligible, welcome DM guide');
    return lines.join('\n');
  }

  /** Report lines shared by /setup and the automatic setup. */
  formatReport(report) {
    const icon = { enabled: '✅', already: '✅', skipped: '⏭️', failed: '⚠️' };
    const lines = [
      `Categories created / Kategori dibuat: ${report.createdCategories}`,
      `Channels created / Channel dibuat: ${report.createdChannels}`,
      `Roles ensured / Role dipastikan ada: ${report.createdRoles}`,
    ];
    if (report.autoRoles) {
      lines.push(`Auto roles: ${report.autoRoles.bots} bot(s), ${report.autoRoles.members} member(s)`);
    }
    if (report.community) lines.push(`Community: ${icon[report.community.status] ?? '•'} ${report.community.detail ?? report.community.status}`);
    if (report.onboarding) lines.push(`Discord Onboarding: ${icon[report.onboarding.status] ?? '•'} ${report.onboarding.detail ?? report.onboarding.status}`);
    lines.push('Bot Onboarding: ✅ welcome DM + next steps after verification');
    if (report.failedDeletions?.length > 0) lines.push(`Failed to delete / Gagal dihapus: ${report.failedDeletions.join(', ')}`);
    if (report.errors?.length > 0) lines.push(`Errors / Error: ${report.errors.join(' | ')}`);
    return lines;
  }

  async runFullSetup(guild, config) {
    const report = {
      failedDeletions: [],
      createdCategories: 0,
      createdChannels: 0,
      createdRoles: 0,
      community: null,
      onboarding: null,
      autoRoles: null,
      errors: [],
    };

    try {
      // 0. Force temporaryVoice.deleteDelay to 0 on every setup run — instant
      // cleanup of empty temp voice rooms is the standing default for this
      // server template, regardless of any prior override.
      await configService.updateGuildConfig(guild.id, { temporaryVoice: { deleteDelay: 0 } });
      config = await configService.getGuildConfig(guild.id);

      // 0b. Community servers can't delete their rules/updates channels, so switch it off for the
      // wipe; communityService.runAutomation() turns it back on at the end.
      const reset = await communityService.prepareForReset(guild);
      if (reset.error) report.errors.push(`Community: ${reset.error}`);

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
      const { verified, staff, selfRoles, member, bot, musicBot } = await roleService.ensureCoreRoles(guild, config);
      report.createdRoles = 2 + [member, bot, musicBot].filter(Boolean).length + Object.keys(selfRoles).length;

      // 6-8. Create categories, channels, permissions — parallelized as much
      // as the dependency chain allows: all categories at once, then every
      // channel across every category at once (each only needs its own
      // already-created parent category id, not any sibling channel), then
      // permissions per category all at once.
      const createdChannelsByName = {};
      const specialChannels = {};
      const interfaceChannels = [];
      let afkChannel = null;

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
                if (channelDef.afk) afkChannel = created;
                report.createdChannels += 1;
              } catch (err) {
                report.errors.push(`Failed to create channel ${channelDef.name}: ${err.message}`);
              }
            })
          );

          await this._applyCategoryPermissions(guild, category, categoryDef, { verified, staff, bot, musicBot }, createdInCategory).catch((err) =>
            report.errors.push(`Permissions failed for ${categoryDef.name}: ${err.message}`)
          );
        })
      );

      // 8b. Point the guild's AFK settings at the 〔💤〕AFK voice channel
      // created above, with a 15-minute timeout (900s — one of Discord's
      // fixed AFK timeout values: 60/300/900/1800/3600).
      if (afkChannel) {
        await guild.setAFKChannel(afkChannel).catch((err) => report.errors.push(`Failed to set AFK channel: ${err.message}`));
        await guild.setAFKTimeout(900).catch((err) => report.errors.push(`Failed to set AFK timeout: ${err.message}`));
      }

      // Remember the special channels so onboarding / community can find them later without name matching.
      await configService
        .updateGuildState(guild.id, { channelIds: Object.fromEntries(Object.entries(specialChannels).map(([key, channel]) => [key, channel.id])) })
        .catch((err) => report.errors.push(`Failed to save channel IDs: ${err.message}`));

      // 9-11. Panels — independent of each other, run concurrently.
      // Each panel is isolated: one failing to post (missing permission, etc.) is reported but
      // must not abort the rest of the setup (rules, voice guides, stats).
      const safe = (label, promise) => (promise ? promise.catch((err) => report.errors.push(`${label}: ${err.message}`)) : null);
      await Promise.all([
        safe('Failed to post verification panel', specialChannels.verification ? verificationService.ensurePanel(specialChannels.verification) : null),
        // 10. Take-role panel is posted by the roles command/service on demand via /roles setup,
        // but we also seed it here so setup is self-contained.
        safe('Failed to post take-role panel', specialChannels['take-role'] ? roleService.ensureTakeRolePanel(specialChannels['take-role'], config) : null),
        // 11. Ticket panel
        safe('Failed to post ticket panel', specialChannels['ticket-panel'] ? ticketService.ensurePanel(specialChannels['ticket-panel'], config) : null),
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
              const guideEmbed = primaryEmbed(VOICE_GUIDE.title, null).addFields(
                { name: '🇮🇩 Bahasa Indonesia', value: VOICE_GUIDE.id },
                { name: '🇬🇧 English', value: VOICE_GUIDE.en }
              );
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

      // 16. Populate the Server Stats channels with real numbers right away
      // instead of leaving them at their placeholder "0" until the next
      // 10-minute scheduled update.
      await statsService.updateGuildStats(guild).catch((err) => report.errors.push(`Failed to populate server stats: ${err.message}`));

      // 17. Give bots Bot / Bot Musik and verified members Member, so nobody already in the server is missed.
      report.autoRoles = await roleService
        .syncAutoRoles(guild, config)
        .catch((err) => (report.errors.push(`Auto roles: ${err.message}`), null));

      // 18. Community + Discord onboarding (last, because they need the finished channel layout).
      const automation = await communityService.runAutomation(guild, config, { specialChannels, selfRoles });
      report.community = automation.community;
      report.onboarding = automation.onboarding;
      if (automation.community.status === 'failed') report.errors.push(`Community: ${automation.community.detail}`);

      report.success = true;
    } catch (err) {
      logger.error('Setup failed', err.message);
      report.success = false;
      report.errors.push(err.message);
    }

    return report;
  }

  /**
   * Non-destructive retrofit for servers that are already built: gives Bot / Bot Musik access to every
   * category from the template (and its channels) by name. Stats and staff-only categories are skipped.
   */
  async applyBotRolePermissions(guild, { bot, musicBot }) {
    const wanted = SERVER_STRUCTURE.filter((c) => !c.statsCategory && !c.staffOnly);
    const edits = [];
    for (const def of wanted) {
      const target = def.name.toLowerCase();
      const category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === target);
      if (!category) continue;
      const targets = [category, ...guild.channels.cache.filter((c) => c.parentId === category.id).values()];
      for (const channel of targets) {
        if (bot) edits.push(channel.permissionOverwrites.edit(bot, toNamedMap(BOT_ALLOW_NAMES), { reason: 'Yorozu: Bot role access' }).catch((err) => logger.warn(`Bot overwrite failed on "${channel.name}"`, err.message)));
        if (musicBot) edits.push(channel.permissionOverwrites.edit(musicBot, toNamedMap(MUSIC_BOT_ALLOW_NAMES), { reason: 'Yorozu: Bot Musik role access' }).catch((err) => logger.warn(`Bot Musik overwrite failed on "${channel.name}"`, err.message)));
      }
    }
    await Promise.all(edits);
  }

  /** Non-destructive: roles + bot access + Community + onboarding on an existing server. Deletes nothing. */
  async runCommunitySetup(guild, config) {
    const report = { createdCategories: 0, createdChannels: 0, createdRoles: 0, community: null, onboarding: null, autoRoles: null, failedDeletions: [], errors: [] };
    try {
      const { member, bot, musicBot, selfRoles } = await roleService.ensureCoreRoles(guild, config);
      report.createdRoles = 2 + [member, bot, musicBot].filter(Boolean).length + Object.keys(selfRoles).length;
      await this.applyBotRolePermissions(guild, { bot, musicBot });
      report.autoRoles = await roleService.syncAutoRoles(guild, config);
      const automation = await communityService.runAutomation(guild, config, { selfRoles });
      report.community = automation.community;
      report.onboarding = automation.onboarding;
      if (automation.community.status === 'failed') report.errors.push(`Community: ${automation.community.detail}`);
      report.success = true;
    } catch (err) {
      logger.error('Community setup failed', err.message);
      report.success = false;
      report.errors.push(err.message);
    }
    return report;
  }

  async _applyCategoryPermissions(guild, category, categoryDef, { verified, staff, bot, musicBot }, createdInCategory) {
    const everyone = guild.roles.everyone;
    const overwrites = [];

    if (categoryDef.staffOnly) {
      overwrites.push({ id: everyone.id, deny: [PermissionFlagsBits.ViewChannel] });
      overwrites.push({ id: staff.id, allow: STAFF_ALLOW });
    } else if (categoryDef.statsCategory) {
      // Visible to everyone (verified or not) — the whole point is showing
      // off live counts — but nobody can actually join these voice channels.
      overwrites.push({ id: everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] });
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

    if (!categoryDef.statsCategory && !categoryDef.staffOnly) {
      if (bot) overwrites.push({ id: bot.id, allow: toBits(BOT_ALLOW_NAMES) });
      if (musicBot) overwrites.push({ id: musicBot.id, allow: toBits(MUSIC_BOT_ALLOW_NAMES) });
    }

    await category.permissionOverwrites.set(overwrites, 'Server setup: category permissions');

    // The child channels were created *before* these category overwrites existed, and Discord
    // does not push a category's overwrites down to children that already exist. Explicitly
    // sync every child now, otherwise "hidden until verified" would only apply to the category itself.
    await Promise.all(
      createdInCategory.map(({ channel }) =>
        channel.lockPermissions().catch((err) => logger.warn(`Failed to sync permissions for "${channel.name}"`, err.message))
      )
    );

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
