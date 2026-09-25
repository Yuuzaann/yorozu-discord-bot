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
    name: '📊 Server Stats',
    readonly: false,
    statsCategory: true,
    channels: [
      { name: '👤・All Members: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '✨・Members: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '🤖・Bots: 0', type: ChannelType.GuildVoice, voice: true },
      { name: '📁・Channels: 0', type: ChannelType.GuildVoice, voice: true },
    ],
  },
  {
    name: '🌐 Important',
    readonly: true,
    channels: [
      { name: '👋・welcome', type: ChannelType.GuildText, special: 'welcome', unverifiedVisible: true },
      { name: '☑️・rules', type: ChannelType.GuildText, special: 'rules', unverifiedVisible: true },
      { name: '✉️・link-invite', type: ChannelType.GuildText },
      { name: '🎭・take-role', type: ChannelType.GuildText, special: 'take-role', unverifiedVisible: true },
      {
        name: '🔒・verification',
        type: ChannelType.GuildText,
        special: 'verification',
        unverifiedVisible: true,
        unverifiedWritable: true,
        hideFromVerifiedRole: true,
      },
      { name: '👋・goodbye', type: ChannelType.GuildText, special: 'goodbye' },
    ],
  },
  {
    name: '🎟️ Support',
    readonly: true,
    channels: [
      { name: '🎫・ticket', type: ChannelType.GuildText, special: 'ticket-panel' },
    ],
  },
  {
    name: '📰 News',
    readonly: true,
    channels: [
      { name: '📢・announcements', type: ChannelType.GuildText },
      { name: '🎁・free-games', type: ChannelType.GuildText },
    ],
  },
  {
    name: '👥 Main',
    readonly: false,
    channels: [
      { name: '💬・general', type: ChannelType.GuildText, special: 'general', unverifiedVisible: true, unverifiedWritable: true },
      { name: '[ID]・chat-id', type: ChannelType.GuildText },
      { name: '[GB]・chat-en', type: ChannelType.GuildText },
      { name: '🎬・media-share', type: ChannelType.GuildText },
      { name: '🎨・random-art', type: ChannelType.GuildText },
    ],
  },
  {
    name: '☕ Chill Room',
    readonly: false,
    channels: [
      { name: '💬・song-request', type: ChannelType.GuildText },
      { name: '☕・chill-chat', type: ChannelType.GuildText },
      { name: '🎵・music', type: ChannelType.GuildText },
      { name: '➕・Join to Create', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '🎮 Game Zone',
    readonly: false,
    channels: [
      { name: '✨・interface', type: ChannelType.GuildText, special: 'interface', channelReadonly: true },
      { name: '💬・game-chat', type: ChannelType.GuildText },
      { name: '🎮・game-room', type: ChannelType.GuildText },
      { name: '➕・Join to Create', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '🔊 Voice Public',
    readonly: false,
    channels: [
      { name: '✨・interface', type: ChannelType.GuildText, special: 'interface', channelReadonly: true },
      { name: '💬・voice-chat', type: ChannelType.GuildText },
      { name: '📢・voice-info', type: ChannelType.GuildText },
      { name: '➕・Join to Create', type: ChannelType.GuildVoice, voice: true, tempVoiceTrigger: true },
    ],
  },
  {
    name: '⚙️ Bot Logs',
    readonly: false,
    staffOnly: true,
    channels: [
      { name: '🔗・invite-log', type: ChannelType.GuildText },
      { name: '🔗・action-log', type: ChannelType.GuildText },
    ],
  },
  {
    name: '💤 AFK',
    readonly: false,
    channels: [{ name: '💤・AFK', type: ChannelType.GuildVoice, voice: true, afk: true }],
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
