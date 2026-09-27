import { ChannelType } from 'discord.js';

/**
 * Declarative description of the categories/channels the bot creates.
 * `type` is a ChannelType constant. `voice: true` marks voice channels.
 * `readonly` categories get the read-only member overwrite applied by
 * serverSetup.applyCategoryPermissions. `channelReadonly` on an individual
 * channel does the same thing at the single-channel level (used for
 * announcement/interface-style channels inside otherwise normal
 * categories) — regular members can view but not send/embed/attach; only
 * Staff/Admin/the bot can post. `hideFromVerifiedRole` denies ViewChannel
 * for the Verified role specifically at the channel level (used for the
 * verification channel: open before verifying, gone afterwards — Staff/
 * Admin keep access since that's a separate role/permission entirely).
 * `statsCategory` marks the Server Stats category: visible to everyone
 * (verified or not) but nobody can actually join those voice channels —
 * their names are periodically rewritten by statsService with live counts.
 */
export const SERVER_STRUCTURE = [
  {
    name: '📊 SERVER STATS',
    readonly: false,
    statsCategory: true,
    channels: [
      { name: '〔👤〕 ALL MEMBERS: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '〔✨〕 MEMBERS: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '〔🤖〕 BOTS: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '〔📁〕 CHANNELS: 0', type: ChannelType.GuildVoice, voice: true },
    ],
  },
  {
    name: '🌐 ┊ IMPORTANT',
    readonly: true,
    channels: [
      { name: '〔👋〕 WELCOME', type: ChannelType.GuildText, special: 'welcome', unverifiedVisible: true },
      { name: '〔☑️〕 RULES', type: ChannelType.GuildText, special: 'rules', unverifiedVisible: true },
      { name: '〔✉️〕 LINK INVITE', type: ChannelType.GuildText },
      { name: '〔🎭〕 TAKE ROLE', type: ChannelType.GuildText, special: 'take-role', unverifiedVisible: true },
      {
        name: '〔🔒〕 VERIFICATION',
        type: ChannelType.GuildText,
        special: 'verification',
        unverifiedVisible: true,
        unverifiedWritable: true,
        hideFromVerifiedRole: true,
      },
      { name: '〔👋〕 GOODBYE', type: ChannelType.GuildText, special: 'goodbye' },
    ],
  },
  {
    name: '🎟️ ┊ SUPPORT',
    readonly: true,
    channels: [
      { name: '〔🎫〕 TICKET', type: ChannelType.GuildText, special: 'ticket-panel' },
    ],
  },
  {
    name: '📰 ┊ NEWS',
    readonly: true,
    channels: [
      { name: '〔📢〕 ANNOUNCEMENTS', type: ChannelType.GuildText },
      { name: '〔🎁〕 FREE GAMES', type: ChannelType.GuildText },
    ],
  },
  {
    name: '👥 ┊ MAIN',
    readonly: false,
    channels: [
      { name: '〔💬〕 GENERAL', type: ChannelType.GuildText, special: 'general', unverifiedVisible: true, unverifiedWritable: true },
      { name: '〔🇮🇩〕 CHAT ID', type: ChannelType.GuildText },
      { name: '〔🇬🇧〕 CHAT EN', type: ChannelType.GuildText },
      { name: '〔🎬〕 MEDIA SHARE', type: ChannelType.GuildText },
      { name: '〔🎨〕 RANDOM ART', type: ChannelType.GuildText },
    ],
  },
  {
    name: '☕ ┊ CHILL ROOM',
    readonly: false,
    channels: [
      { name: '〔💬〕 CHILL CHAT', type: ChannelType.GuildText },
      { name: '〔🎵〕 SONG REQUEST', type: ChannelType.GuildText },
      { name: '〔🎧〕 MUSIC', type: ChannelType.GuildText },
      { name: '〔➕〕 JOIN TO CREATE', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '🎮 ┊ GAME ZONE',
    readonly: false,
    channels: [
      { name: '〔✨〕 INTERFACE', type: ChannelType.GuildText, special: 'interface', channelReadonly: true },
      { name: '〔💬〕 GAME CHAT', type: ChannelType.GuildText },
      { name: '〔🎮〕 GAME ROOM', type: ChannelType.GuildText },
      { name: '〔➕〕 JOIN TO CREATE', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '🔊 ┊ VOICE PUBLIC',
    readonly: false,
    channels: [
      { name: '〔✨〕 INTERFACE', type: ChannelType.GuildText, special: 'interface', channelReadonly: true },
      { name: '〔💬〕 VOICE CHAT', type: ChannelType.GuildText },
      { name: '〔📢〕 VOICE INFO', type: ChannelType.GuildText },
      { name: '〔➕〕 JOIN TO CREATE', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '⚙️ ┊ BOT LOGS',
    readonly: false,
    staffOnly: true,
    channels: [
      { name: '〔🔗〕 INVITE LOG', type: ChannelType.GuildText },
      { name: '〔🔗〕 ACTION LOG', type: ChannelType.GuildText },
    ],
  },
  {
    name: '💤 ┊ AFK',
    readonly: false,
    channels: [{ name: '〔💤〕 AFK', type: ChannelType.GuildVoice, voice: true, afk: true }],
  },
];

export const FORBIDDEN_NAMES = [
  'server stats',
  'all members',
  'members',
  'bots',
  'channels',
  'chat-ai',
  'chat-with-ai',
  'anime-donghua',
  'moonlight news',
];
