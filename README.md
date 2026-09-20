<div align="center">

# 🏮 Yorozu

### All-in-one Discord community management bot

*"Yorozu" (万) — Japanese for "ten thousand" / "everything". A* ***yorozuya*** *(万屋) is an old term for a shop that handles a little bit of everything. This bot is the yorozuya of your Discord server: setup, verification, roles, tickets, voice, and welcomes — all in one place.*

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18.17-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](#-license)
[![Bilingual](https://img.shields.io/badge/Language-🇮🇩%20ID%20%2F%20🇬🇧%20EN-blue)](#)

</div>

---

## 📖 About

**Yorozu** is a production-ready Discord bot built for communities that want a clean, secure, self-service server without an admin having to babysit every join, role request, or support ticket. Run one command and it builds your entire server structure — categories, channels, roles, and permissions — from scratch. Everything after that runs itself: members verify with a one-time code, pick their own roles, open their own support tickets, and get their own private voice rooms on demand.

Every message the bot sends is **bilingual (🇮🇩 Indonesian / 🇬🇧 English)** by default, so it fits communities that mix both languages without any extra configuration.

---

## ✨ Features

### 🏗️ One-command server setup
- `/setup preview` — see the full category/channel structure before touching anything
- `/setup server` — wipes and rebuilds the entire server (with a confirm/cancel safety button, and an in-memory lock so it can never run twice at once)
- Every independent step (deleting old channels, creating new ones, applying permissions, posting panels) runs **concurrently**, not one API call at a time
- Auto-posts a bilingual server rules embed to the rules channel, and a full `/voice` command guide to every interface channel — every single run

### 🔐 OTP-based verification
- Click **Verify** → the bot DMs a 6-digit one-time code → run `/otp <code>` to confirm
- Codes expire after 5 minutes and lock out after 5 wrong attempts
- The verification channel is visible and open to chat *before* verifying, then **disappears entirely** once verified — no clutter afterward
- Clean, dismissible ephemeral messages at every step; a clear bilingual error if the member has DMs disabled

### 🎭 Self-service roles
- A take-role panel where members multi-select their own tags (Gamer, Artist, Developer, Music, Movie, Night Owl, or whatever you configure)
- Automatically cleans up roles that are no longer in the configured list — no orphaned roles left behind when you change the list
- Hard-blocked from ever granting dangerous permissions (Administrator, Manage Roles/Channels/Guild, Ban/Kick/Moderate Members) — enforced in code, not just convention

### 🎫 Full ticket system
- Category-based ticket panel (General Support / Technical Support / Report / Partnership / Other — fully configurable)
- One active ticket per member (configurable), claim/close/reopen/delete-with-confirmation, staff-only visibility, and a plain-text transcript export
- Every action is logged to a dedicated staff-only log channel

### 🔊 Temporary voice rooms
- Join **➕・Join to Create** → get your own private voice room instantly, moved in automatically
- Full self-management: `/voice name`, `/voice limit`, `/voice lock`/`unlock`, `/voice claim`, `/voice kick`, `/voice info`
- Rooms delete themselves the instant they're empty — no manual cleanup, ever

### 👋 Welcome & goodbye cards
- Generates a banner image (avatar, member count, server name) on join/leave, Canva-card style
- Fully templated text messages alongside the image — edit them anytime with `/config set welcome.message "..."`

### 🤖 Configurable bot presence
- `/status set` / `/status clear` — set the bot's Discord activity and online status to anything, anytime
- Restricted to the bot's **application owner** specifically (a bot has one presence shared across every server it's in, so this intentionally isn't a per-server admin toggle)
- Persists across restarts

### 🌍 Multi-server ready
- No hardcoded guild — every setting lives in a per-guild config store, so one bot instance serves unlimited servers
- Deploy commands globally once and invite it anywhere, no `.env` changes needed per server

---

## 📋 Requirements

- **Node.js ≥ 18.17** (this bot uses ES Modules and native `node:` imports — anything older, including Node 12/14/16, will not run it)
- A Discord application with the **Server Members** and **Message Content** privileged intents enabled in the [Developer Portal](https://discord.com/developers/applications)

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# fill in DISCORD_TOKEN and CLIENT_ID (GUILD_ID is optional — see "Publishing" below)

# 3. Register slash commands
npm run deploy

# 4. Run it
npm start        # or: npm run dev  (auto-restarts on file changes)
```

**Invite permissions:** `Administrator` is simplest given the scope of what this bot manages; at minimum it needs `Manage Channels`, `Manage Roles`, `Manage Messages`, `Move Members`, `Connect`, `View Channel`, `Send Messages`, `Embed Links`.

---

## 🤖 Commands

| Category | Commands |
|---|---|
| **Setup** | `/setup preview` `/setup server` |
| **Verification** | `/verify setup` `/verify panel` `/verify status` `/otp <code>` |
| **Roles** | `/roles setup` |
| **Tickets** | `/ticket setup` `/ticket close` `/ticket reopen` `/ticket claim` `/ticket delete` `/ticket transcript` |
| **Voice** | `/voice name` `/voice limit` `/voice lock` `/voice unlock` `/voice claim` `/voice kick` `/voice info` |
| **Config** | `/config view` `/config set <key> <value>` `/config staff-role` |
| **Bot status** | `/status set` `/status clear` *(bot owner only)* |
| **General** | `/help` |

Run `/help` in Discord any time for a live, in-app version of this list.

---

## ⚙️ Configuration

All runtime settings live in `data/config.json`, scoped per guild, and can be changed live with `/config set <dotted.key> <value>` — no restart required. A few highlights:

```bash
/config set welcome.message "Welcome {user} to {server}!"
/config set temporaryVoice.deleteDelay 5000   # ms grace period before an empty room is deleted
/config set ticket.maxTicketsPerUser 2
/config set rules.content "Your own custom rules text"
/config staff-role @Staff
```

See `src/config/defaultConfig.js` for the full list of available keys and their defaults.

---

## 🌐 Publishing for many servers

Yorozu is multi-server by design. `GUILD_ID` in `.env` is *only* used to speed up command registration during local development (guild-scoped commands appear instantly instead of the ~1 hour global propagation delay). To go public:

1. Leave `GUILD_ID` empty in `.env`
2. Run `npm run deploy` once — commands register globally
3. Generate an OAuth2 invite link (`bot` + `applications.commands` scopes) and share it

Every guild's config, roles, and tickets are stored independently — nothing leaks between servers.

---

## 🔒 Security

- Dangerous permissions can **never** be granted through self-roles, tickets, or temporary voice ownership — this is enforced in `src/utils/permissions.js` and checked before every single role grant, not left to configuration discipline
- `/setup server` requires an explicit confirm button and locks per-guild to prevent concurrent runs
- `/status` (bot-wide presence) is restricted to the application owner, never a per-guild role
- OTP verification codes expire and rate-limit wrong attempts

---

## 🏗️ Project Structure

```
src/
├── commands/    Slash command definitions and their handlers
├── events/      discord.js Gateway event handlers (ready, interactionCreate, voiceStateUpdate, ...)
├── services/    Business logic — setup, tickets, roles, verification, temp voice, welcome cards, config, logging
├── config/      Static server structure + default runtime configuration
├── utils/       Logging, embeds, permission checks, bilingual text helpers, string utilities
├── index.js     Entry point — loads commands/events and logs in
└── deploy-commands.js   Registers slash commands with Discord
```

---

## 📄 License

MIT — do whatever you want with it.

<div align="center">

*Built for communities that deserve a server that runs itself.*

</div>
