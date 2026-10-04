/**
 * Default configuration. This is merged with data/config.json (per-guild
 * overrides are stored under configs[guildId]) by configService.
 */
export const defaultConfig = {
  verification: {
    enabled: true,
    roleName: 'Verified',
    channelName: 'verification',
  },
  temporaryVoice: {
    enabled: true,
    deleteDelay: 0,
    nameFormat: "🔊・{username}'s Room",
    triggerChannelNames: ['〔➕〕JOIN TO CREATE'],
  },
  ticket: {
    enabled: true,
    staffRoleId: null,
    maxTicketsPerUser: 1,
    cooldown: 10000,
    autoDeleteClosed: false,
    autoDeleteDelay: 86400000,
    transcriptEnabled: true,
    categories: [
      { id: 'general', label: 'Bantuan Umum / General Support', emoji: '🎫' },
      { id: 'technical', label: 'Bantuan Teknis / Technical Support', emoji: '🛠️' },
      { id: 'report', label: 'Laporan / Report', emoji: '🚨' },
      { id: 'partnership', label: 'Kerjasama / Partnership', emoji: '🤝' },
      { id: 'other', label: 'Lainnya / Other', emoji: '❓' },
    ],
  },
  selfRoles: {
    enabled: true,
    options: [
      { id: 'gamer', label: 'Gamer', emoji: '🎮', color: 0x3ba5f0 },
      { id: 'artist', label: 'Artist', emoji: '🎨', color: 0xed4a6a },
      { id: 'developer', label: 'Developer', emoji: '💻', color: 0x2ecc71 },
      { id: 'music', label: 'Music', emoji: '🎵', color: 0x9b59b6 },
      { id: 'movie', label: 'Movie', emoji: '🎬', color: 0xe67e22 },
      { id: 'nightowl', label: 'Night Owl', emoji: '🌙', color: 0x99aab5 },
    ],
  },
  logging: {
    enabled: true,
    inviteLogChannelName: '〔🔗〕INVITE LOG',
    actionLogChannelName: '〔🔗〕ACTION LOG',
  },
  welcome: {
    enabled: true,
    channelName: 'welcome',
    useCard: true,
    message:
      'Selamat datang {user} di **{server}**! Kamu member ke-**{membercount}**. 🎉\nWelcome {user} to **{server}**! You are member **#{membercount}**. 🎉',
  },
  goodbye: {
    enabled: true,
    channelName: 'goodbye',
    useCard: true,
    message:
      '👋 **{username}** telah meninggalkan **{server}**. Sekarang tersisa **{membercount}** member.\n👋 **{username}** has left **{server}**. **{membercount}** members remain.',
  },
  setup: {
    staffRoleName: 'Staff',
  },
  rules: {
    // If null, the bilingual DEFAULT_RULES from src/config/rulesContent.js is posted.
    // Override with /config set rules.content "your own text" for a custom set of rules.
    content: null,
  },
  serverStats: {
    // Toggle with /config set serverStats.enabled false. Update cadence is
    // fixed at 10 minutes in index.js (matching Discord's channel-rename
    // rate limit), not configurable per guild — see statsService.js.
    enabled: true,
  },
  economy: {
    enabled: true,
    currencyName: 'Koin',
    currencySymbol: '🪙',
    startingBalance: 100,
    dailyAmount: 500,
    // Extra coins per consecutive daily claim (capped at 30 days worth),
    // e.g. streak day 5 pays dailyAmount + 4 * dailyStreakBonus.
    dailyStreakBonus: 50,
    workMinAmount: 100,
    workMaxAmount: 400,
    workCooldownMinutes: 60,
    // Cosmetic items members can buy with /economy buy. `roleId: null` means
    // a purely cosmetic entry (no functional effect, just bragging rights);
    // set a real role ID to have a purchase grant that role automatically
    // (still passes through the same dangerous-permission guard as every
    // other role grant in the bot — see utils/permissions.js).
    shop: [
      { id: 'vip-badge', name: '⭐ VIP Badge', price: 5000, roleId: null },
      { id: 'flex-badge', name: '💎 Flex Badge', price: 10000, roleId: null },
    ],
  },
};

/** Roles that must never be grantable through self-role, ticket or voice systems. */
export const DANGEROUS_PERMISSIONS = [
  'Administrator',
  'ManageGuild',
  'ManageRoles',
  'ManageChannels',
  'BanMembers',
  'KickMembers',
  'ModerateMembers',
];
