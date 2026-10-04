import { ChannelType, PermissionFlagsBits, Routes, SnowflakeUtil } from 'discord.js';
import { createLogger } from '../utils/logger.js';
import { normalizeName } from '../utils/normalize.js';
import { primaryEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { configService } from './configService.js';

const logger = createLogger('CommunityService');

// Guild features a bot is allowed to send back in a PATCH (the rest are read-only / granted by Discord).
const MUTABLE_FEATURES = new Set(['COMMUNITY', 'DISCOVERABLE', 'INVITES_DISABLED', 'RAID_ALERTS_DISABLED']);

// Discord requires these for Community: verification >= Low (1) and media filter = all members (2).
const MIN_VERIFICATION_LEVEL = 1;
const EXPLICIT_FILTER_ALL_MEMBERS = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const hasCommunity = (guild) => guild.features.includes('COMMUNITY');
const mutableFeatures = (guild) => guild.features.filter((f) => MUTABLE_FEATURES.has(f));

class CommunityService {
  _patchGuild(guild, body, reason) {
    return guild.client.rest.patch(Routes.guild(guild.id), { body, reason });
  }

  /**
   * Looks up the channels this service cares about. Prefers the IDs saved by /setup (state.channelIds),
   * falling back to a loose name match so it also works on servers set up before this feature existed.
   */
  async resolveChannels(guild) {
    const state = await configService.getGuildState(guild.id);
    const ids = state.channelIds ?? {};
    const pick = (key, needle) => {
      const saved = ids[key] ? guild.channels.cache.get(ids[key]) : null;
      if (saved) return saved;
      const target = normalizeName(needle);
      return guild.channels.cache.find((c) => c.type === ChannelType.GuildText && normalizeName(c.name).includes(target)) ?? null;
    };
    return {
      rules: pick('rules', 'rules'),
      verification: pick('verification', 'verification'),
      takeRole: pick('take-role', 'take role'),
      general: pick('general', 'general'),
      updates: pick('community-updates', 'action log'),
    };
  }

  /**
   * Discord refuses to delete the rules / community-updates channels of a Community server
   * (error 50074), which would break /setup server's channel wipe — so Community is switched off
   * right before the wipe and switched back on afterwards by runAutomation().
   */
  async prepareForReset(guild) {
    if (!hasCommunity(guild)) return { wasCommunity: false };
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return { wasCommunity: true, error: 'Bot needs the Manage Server permission to switch Community off before a reset.' };
    }
    try {
      const features = mutableFeatures(guild).filter((f) => f !== 'COMMUNITY' && f !== 'DISCOVERABLE');
      await this._patchGuild(guild, { features }, 'Yorozu: Community off during server reset (re-enabled afterwards)');
      return { wasCommunity: true };
    } catch (err) {
      logger.warn('Failed to switch Community off before reset', err.message);
      return { wasCommunity: true, error: err.message };
    }
  }

  async enableCommunity(guild, { rulesChannel, updatesChannel }) {
    if (!guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return { status: 'skipped', detail: 'Bot needs the Manage Server permission. / Bot butuh izin Manage Server.' };
    }
    if (!rulesChannel || !updatesChannel) {
      return { status: 'skipped', detail: 'Rules / ACTION LOG channel not found. / Channel rules atau ACTION LOG tidak ditemukan.' };
    }
    const already = hasCommunity(guild);
    try {
      await this._patchGuild(
        guild,
        {
          features: [...new Set([...mutableFeatures(guild), 'COMMUNITY'])],
          rules_channel_id: rulesChannel.id,
          public_updates_channel_id: updatesChannel.id,
          verification_level: Math.max(guild.verificationLevel ?? 0, MIN_VERIFICATION_LEVEL),
          explicit_content_filter: EXPLICIT_FILTER_ALL_MEMBERS,
        },
        'Yorozu: enable Community'
      );
      return {
        status: already ? 'already' : 'enabled',
        detail: `Rules → #${rulesChannel.name}, updates → #${updatesChannel.name}`,
      };
    } catch (err) {
      logger.warn('Failed to enable Community', err.message);
      return { status: 'failed', detail: err.message };
    }
  }

  /**
   * Configures Discord's built-in Onboarding: an "interests" prompt that hands out the self-roles and a
   * "language" prompt that surfaces the ID/EN chat channels. Discord only accepts this when >= 7 text
   * channels are visible to @everyone and >= 5 of them are writable — checked up front, so a server that
   * doesn't meet it gets a clear "skipped" instead of an API error.
   */
  async setupNativeOnboarding(guild, config, { selfRoles }) {
    // Permission overwrites were edited moments ago; give the gateway cache time to catch up.
    await sleep(1500);
    const everyone = guild.roles.everyone;
    const visible = guild.channels.cache.filter(
      (c) => (c.type === ChannelType.GuildText || c.type === ChannelType.GuildAnnouncement) && c.permissionsFor(everyone)?.has(PermissionFlagsBits.ViewChannel)
    );
    const writable = visible.filter((c) => c.permissionsFor(everyone)?.has(PermissionFlagsBits.SendMessages));
    if (visible.size < 7 || writable.size < 5) {
      return {
        status: 'skipped',
        detail: `Discord needs ≥7 channels visible to @everyone (≥5 writable); this layout has ${visible.size}/${writable.size} because most channels unlock after verification. The bot's own onboarding is used instead.`,
      };
    }

    const prompts = [];
    const interestOptions = config.selfRoles.options
      .filter((o) => selfRoles[o.id])
      .map((o) => ({
        id: SnowflakeUtil.generate().toString(),
        title: o.label,
        description: `Dapat role ${o.label} / Get the ${o.label} role`.slice(0, 100),
        emoji_name: o.emoji,
        role_ids: [selfRoles[o.id].id],
        channel_ids: [],
      }));
    if (interestOptions.length > 0) {
      prompts.push({
        id: SnowflakeUtil.generate().toString(),
        title: 'Apa minatmu? / What are you into?',
        options: interestOptions,
        single_select: false,
        required: false,
        in_onboarding: true,
        type: 0,
      });
    }

    const findText = (needle) => visible.find((c) => normalizeName(c.name).includes(normalizeName(needle)));
    const chatId = findText('chat id');
    const chatEn = findText('chat en');
    const languageOptions = [
      chatId && { id: SnowflakeUtil.generate().toString(), title: 'Bahasa Indonesia', emoji_name: '🇮🇩', role_ids: [], channel_ids: [chatId.id] },
      chatEn && { id: SnowflakeUtil.generate().toString(), title: 'English', emoji_name: '🇬🇧', role_ids: [], channel_ids: [chatEn.id] },
    ].filter(Boolean);
    if (languageOptions.length > 0) {
      prompts.push({
        id: SnowflakeUtil.generate().toString(),
        title: 'Bahasa / Language',
        options: languageOptions,
        single_select: false,
        required: false,
        in_onboarding: true,
        type: 0,
      });
    }

    try {
      await guild.client.rest.put(Routes.guildOnboarding(guild.id), {
        body: { prompts, default_channel_ids: [...visible.keys()], enabled: true, mode: 0 },
        reason: 'Yorozu: set up Onboarding',
      });
      return { status: 'enabled', detail: `${prompts.length} prompt(s), ${visible.size} default channels` };
    } catch (err) {
      logger.warn('Failed to set up native onboarding', err.message);
      return { status: 'failed', detail: err.message };
    }
  }

  /** Community + native onboarding, in the order Discord requires. Never throws. */
  async runAutomation(guild, config, { specialChannels = null, selfRoles = {} } = {}) {
    let community = { status: 'skipped', detail: 'disabled in config (community.enabled)' };
    if (config.community.enabled) {
      const found = specialChannels ? null : await this.resolveChannels(guild);
      community = await this.enableCommunity(guild, {
        rulesChannel: specialChannels?.rules ?? found?.rules,
        updatesChannel: specialChannels?.['community-updates'] ?? found?.updates,
      });
    }

    let onboarding;
    if (!config.onboarding.enabled || !config.onboarding.native) {
      onboarding = { status: 'skipped', detail: 'native onboarding disabled in config' };
    } else if (community.status !== 'enabled' && community.status !== 'already') {
      onboarding = { status: 'skipped', detail: 'needs Community to be enabled first' };
    } else {
      onboarding = await this.setupNativeOnboarding(guild, config, { selfRoles }).catch((err) => ({ status: 'failed', detail: err.message }));
    }
    return { community, onboarding };
  }

  /** Bilingual "what to do next" line shown after verification. Null if the channels aren't known. */
  async nextSteps(guild) {
    const { takeRole, general } = await this.resolveChannels(guild);
    if (!takeRole && !general) return null;
    const id = [takeRole && `pilih role di <#${takeRole.id}>`, general && `lalu sapa semua di <#${general.id}>`].filter(Boolean).join(' ');
    const en = [takeRole && `pick your roles in <#${takeRole.id}>`, general && `then say hi in <#${general.id}>`].filter(Boolean).join(' ');
    return bi(`Langkah berikutnya: ${id}.`, `Next: ${en}.`);
  }

  /** Welcome DM with the step-by-step guide. Returns false if it could not be sent (DMs closed, disabled, bot). */
  async sendOnboardingDM(member, config) {
    if (!config.onboarding?.enabled || !config.onboarding.dm || member.user.bot) return false;
    const ch = await this.resolveChannels(member.guild);
    const steps = [];
    if (ch.rules) steps.push(`Baca aturan / Read the rules — <#${ch.rules.id}>`);
    if (ch.verification && config.verification.enabled !== false) {
      steps.push(`Verifikasi dengan OTP / Verify with OTP — <#${ch.verification.id}>`);
    }
    if (ch.takeRole) steps.push(`Pilih role minatmu / Pick your interest roles — <#${ch.takeRole.id}>`);
    if (ch.general) steps.push(`Sapa semua orang / Say hi — <#${ch.general.id}>`);
    if (steps.length === 0) return false;

    const embed = primaryEmbed(
      biTitle(`👋 Selamat datang di ${member.guild.name}`, `Welcome to ${member.guild.name}`),
      steps.map((text, i) => `**${i + 1}.** ${text}`).join('\n')
    ).setFooter({ text: 'Butuh bantuan? Buka tiket. / Need help? Open a ticket.' });

    try {
      await member.send({ embeds: [embed] });
      return true;
    } catch (err) {
      logger.info(`Onboarding DM to ${member.user.tag} not delivered (DMs probably closed)`);
      return false;
    }
  }
}

export const communityService = new CommunityService();
