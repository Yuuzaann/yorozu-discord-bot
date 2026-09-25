<div align="center">

# 🏮 Yorozu

### The all-in-one Discord bot that runs your server so you don't have to

*"Yorozu" (万) is Japanese for **"ten thousand"** — used idiomatically to mean* ***"everything."*** *A* ***yorozuya*** *(万屋) is an old-fashioned term for a shop that sells a little bit of everything. This bot is the yorozuya of your Discord server — setup, verification, roles, tickets, voice, and welcomes, all handled in one place, so admins can actually enjoy their own community instead of moderating it full-time.*

<br/>

[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518.17-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![ES Modules](https://img.shields.io/badge/Modules-ESM-F7DF1E?logo=javascript&logoColor=black)](https://nodejs.org/api/esm.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Bilingual](https://img.shields.io/badge/Language-🇮🇩%20ID%20%2F%20🇬🇧%20EN-blue)](#-bilingual-by-default)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-contributing)

</div>

<br/>

## 📚 Table of Contents

- [Why Yorozu?](#-why-yorozu)
- [Feature Tour](#-feature-tour)
- [The Server Structure It Builds](#-the-server-structure-it-builds)
- [Requirements](#-requirements)
- [Quick Start](#-quick-start)
- [Command Reference](#-command-reference)
- [Configuration](#-configuration)
- [Publishing to Many Servers](#-publishing-to-many-servers)
- [Security Model](#-security-model)
- [Project Structure](#-project-structure)
- [FAQ](#-faq)
- [Contributing](#-contributing)
- [License](#-license)

<br/>

## 💡 Why Yorozu?

Most Discord communities start the same way: someone builds the channels by hand, forgets to lock down permissions, manually verifies every new member, and ends up copy-pasting the same "pick your roles here" message for the hundredth time. It works — until the server grows past a dozen active members and moderation starts eating every admin's evening.

**Yorozu removes that entire category of work.** Run one command and the bot builds a complete, correctly-permissioned server structure from nothing. From that point on, members verify themselves, assign their own roles, open their own support tickets, and spin up their own private voice rooms — all without an admin lifting a finger, and all without ever accidentally handing out a dangerous permission by mistake.

It's built to be **read**, not just run — every file is commented, every design decision is explained in this README, and nothing happens by magic you can't trace back to a specific line of code.

<br/>

## ✨ Feature Tour

### 🏗️ One-command server setup
Run `/setup preview` any time to see exactly what the bot *would* build — no changes made, completely safe to run. When you're ready, `/setup server` shows a **red confirmation button** before touching anything, then:

1. Wipes every existing category and channel (nothing survives a reset — that's the point)
2. Rebuilds the entire structure: 9 categories, ~30 channels, with permissions applied at the same time
3. Creates every role it needs (`Verified`, `Staff`, and your configured self-roles) — reusing any that already exist by name instead of duplicating them
4. Posts the verification panel, take-role panel, ticket panel, a bilingual rules embed, and a `/voice` command guide — automatically, every run
5. Delivers a full report of what succeeded and what didn't, even if the channel you ran the command in got deleted mid-reset (it falls back to a DM)

Every independent step in that list runs **concurrently** rather than one API call at a time — the whole reset finishes in a handful of batches instead of one round-trip per item.

### 🔐 OTP-based verification
No confusing "react with ✅" buttons that a raid bot can script in an instant. Yorozu uses a real one-time-password flow:

```
Member clicks Verify
        │
        ▼
Bot DMs a 6-digit code  ──────────────►  "📩 Check your DM, then run /otp 123456"
        │
        ▼
Member runs /otp 123456
        │
        ▼
   Correct? ──── No ──► "Wrong code, 4 attempts left" (max 5, then must re-click Verify)
        │
       Yes
        ▼
   Verified role granted — the verification channel disappears for them entirely
```

Codes expire after 5 minutes. If a member's DMs are disabled, they get a clear bilingual explanation of exactly which Discord setting to change, instead of a silent failure.

### 🎭 Self-service roles, safely
The take-role panel lets members **multi-select** several tags at once (Gamer, Artist, Developer, Music, Movie, Night Owl by default — fully configurable). Change the list in `defaultConfig.js` and the bot automatically deletes roles that fell off the list the next time setup runs — no manually hunting down orphaned roles months later.

Every single role grant in the bot — self-roles, ticket permissions, temporary voice ownership — passes through one hard-coded guard that refuses to touch `Administrator`, `Manage Roles`, `Manage Channels`, `Manage Guild`, `Ban Members`, `Kick Members`, or `Moderate Members`. This isn't a setting you could accidentally turn off; it's checked in code before every grant.

### 🎫 A ticket system that doesn't need babysitting
Members pick a category from a dropdown (General Support, Technical Support, Report, Partnership, Other — configurable), and get a private channel with exactly the right permissions already applied. Staff can claim, close, reopen, or delete (with a confirmation step) — and one member can only have one open ticket at a time, so nobody floods your support category. Every action writes to a staff-only audit log automatically.

### 🔊 Temporary voice that cleans up after itself
Join **➕・Join to Create** and a personal voice room appears in the same category, and you're moved into it instantly. From inside it:

| Command | What it does |
|---|---|
| `/voice name` | Rename your room |
| `/voice limit` | Set a member cap (0 = unlimited) |
| `/voice lock` / `/voice unlock` | Control who can join |
| `/voice claim` | Take over if the owner left |
| `/voice kick` | Remove someone from your room |
| `/voice info` | See owner, member count, limit |

The room deletes itself the instant it's empty. No admin ever has to go clean up a graveyard of abandoned voice channels.

### 👋 Welcome & goodbye cards
Every join and leave gets a generated banner image — avatar, member count, server name — alongside a fully templated bilingual message. Change the wording any time with `/config set welcome.message "..."`, no redeploy needed.

### 🤖 A status that's actually yours
`/status set` lets you put anything you want as the bot's Discord activity — *Playing*, *Watching*, *Listening*, *Competing*, or a plain *Custom* status — paired with any online/idle/dnd/invisible state. It's deliberately restricted to the bot's **application owner** rather than any server's admin, because a bot only has one presence shared across every server it's in; letting every admin change it would mean servers fighting over the same status line.

### 📊 Live server stats
A dedicated category shows real-time counts as join-locked voice channel names — 👤 All Members, ✨ Members, 🤖 Bots, 📁 Channels — visible to everyone, nobody able to actually connect to them. They're populated immediately after `/setup server`, refreshed automatically every **10 minutes** (matching Discord's hard limit of 2 name-edits per 10 minutes per channel — not an arbitrary number), and can be force-refreshed any time with `/stats refresh`.

### 🌍 Bilingual by default
Every embed, every button, every error message the bot sends is written in **both Indonesian and English**, side by side. Not a locale switch you have to configure — it's simply how the bot talks, everywhere, all the time.

<br/>

## 🌳 The Server Structure It Builds

```
📊 Server Stats                 (visible to everyone, join-locked — live member/bot/channel counts)
├── 👤 All Members: 0
├── ✨ Members: 0
├── 🤖 Bots: 0
└── 📁 Channels: 0

🌐 Important                    (read-only, but welcome/rules/take-role/verification stay open pre-verification)
├── 👋 welcome
├── ☑️ rules                    ← bilingual rules auto-posted here
├── ✉️ link-invite
├── 🎭 take-role                ← self-role panel
├── 🔒 verification             ← OTP verify panel (vanishes once you're verified)
└── 👋 goodbye

🎟️ Support                     (read-only)
└── 🎫 ticket                   ← ticket category panel

📰 News                         (read-only, Staff/Admin post only)
├── 📢 announcements
└── 🎁 free-games

👥 Main
├── 💬 general                  ← open to everyone, even pre-verification
├── [ID] chat-id
├── [GB] chat-en
├── 🎬 media-share
└── 🎨 random-art

☕ Chill Room
├── 💬 song-request
├── ☕ chill-chat
├── 🎵 music
└── ➕ Join to Create           ← temp voice trigger

🎮 Game Zone
├── ✨ interface                ← read-only, /voice command guide auto-posted
├── 💬 game-chat
├── 🎮 game-room
└── ➕ Join to Create

🔊 Voice Public
├── ✨ interface                ← read-only, /voice command guide auto-posted
├── 💬 voice-chat
├── 📢 voice-info
└── ➕ Join to Create

⚙️ Bot Logs                     (Staff/Admin only)
├── 🔗 invite-log
└── 🔗 action-log

💤 AFK
```

Want a different structure? It's all declarative — edit `src/config/serverStructure.js`, no logic to untangle.

<br/>

## 📋 Requirements

| Requirement | Why |
|---|---|
| **Node.js ≥ 18.17** | The bot uses ES Modules and native `node:` imports. Older runtimes (Node 12/14/16) will fail immediately with `Cannot find module 'node:path'` |
| **Discord application** | Created in the [Developer Portal](https://discord.com/developers/applications) |
| **Server Members intent** | Required for join/leave events and role management |
| **Message Content intent** | Required by discord.js's gateway handshake for this bot's feature set |

<br/>

## 🚀 Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure your environment
cp .env.example .env
# → open .env and fill in DISCORD_TOKEN and CLIENT_ID
#   (GUILD_ID is optional — leave empty unless you're developing locally, see below)

# 3. Register the slash commands with Discord
npm run deploy

# 4. Start the bot
npm start
# or, for auto-restart on file changes during development:
npm run dev
```

**Inviting the bot:** the simplest invite scope is `Administrator`, given how much of the server this bot manages directly. If you'd rather scope it down, the minimum set is `Manage Channels`, `Manage Roles`, `Manage Messages`, `Move Members`, `Connect`, `View Channel`, `Send Messages`, `Embed Links`.

**First run in a server:** an admin should run `/setup preview` first to see what will be built, then `/setup server` to actually build it. The bot also posts a short bilingual pointer to these two commands automatically the moment it joins a new server.

<br/>

## 🤖 Command Reference

| Command | Who can use it | What it does |
|---|---|---|
| `/setup preview` | Administrator | Preview the server structure — makes no changes |
| `/setup server` | Administrator | Reset and rebuild the entire server (confirmation required) |
| `/verify setup` | Administrator | Enable/reconfigure the verification system |
| `/verify panel` | Administrator | (Re)post the verification panel in the current channel |
| `/verify status` | Administrator | Show verification configuration status |
| `/otp <code>` | Anyone | Submit your OTP code to complete verification |
| `/roles setup` | Administrator | (Re)post the take-role panel in the current channel |
| `/ticket setup` | Administrator | (Re)post the ticket panel in the current channel |
| `/ticket close` | Owner / Staff / Admin | Close the current ticket |
| `/ticket reopen` | Owner / Staff / Admin | Reopen a closed ticket |
| `/ticket claim` | Owner / Staff / Admin | Claim a ticket |
| `/ticket delete` | Owner / Staff / Admin | Delete a ticket (confirmation required) |
| `/ticket transcript` | Owner / Staff / Admin | Export the ticket's message history |
| `/voice name/limit/lock/unlock/claim/kick/info` | Room owner (or anyone for `claim`/`info`) | Manage your temporary voice room |
| `/config view` | Administrator | View the current guild configuration as JSON |
| `/config set <key> <value>` | Administrator | Change any configuration value live |
| `/config staff-role` | Administrator | Set which role counts as ticket staff |
| `/stats refresh` | Administrator | Force-refresh the Server Stats channels immediately |
| `/status set` / `/status clear` | **Bot owner only** | Set or clear the bot's Discord presence, globally |
| `/help` | Anyone | Show this command list in Discord |

<br/>

## ⚙️ Configuration

Every guild gets its own independent configuration, stored in `data/config.json` and editable live — no restart, no redeploy:

```bash
/config set welcome.message "Welcome {user} to {server}! 🎉"
/config set temporaryVoice.deleteDelay 5000      # ms grace period before deleting an empty room
/config set ticket.maxTicketsPerUser 2
/config set rules.content "Paste your own custom rules text here"
/config staff-role @Staff
```

The full list of configurable keys — with their defaults and inline comments explaining each one — lives in [`src/config/defaultConfig.js`](./src/config/defaultConfig.js). Every value there is a valid target for `/config set`.

<br/>

## 🌐 Publishing to Many Servers

Yorozu has no hardcoded guild anywhere in its runtime logic — every lookup (roles, channels, config, tickets) is scoped to whichever guild the interaction happened in. `GUILD_ID` in `.env` exists purely to make **command registration** faster during local development (guild-scoped commands appear instantly instead of waiting up to an hour for global propagation).

To make the bot public:

1. Leave `GUILD_ID` empty in `.env`
2. Run `npm run deploy` once — this registers commands **globally**
3. Generate an OAuth2 invite link (`bot` + `applications.commands` scopes) and share it anywhere

Each server's configuration, roles, and tickets are stored completely independently — nothing from one server is ever visible to another.

<br/>

## 🔒 Security Model

- **Dangerous permissions are structurally unreachable**, not just discouraged — `Administrator`, `Manage Roles`, `Manage Channels`, `Manage Guild`, `Ban Members`, `Kick Members`, and `Moderate Members` are checked and refused in code (`src/utils/permissions.js`) before *every* role grant, whether it comes from self-roles, tickets, or voice room ownership.
- **`/setup server` is destructive by design and treated that way**: an explicit confirm button is required, and a per-guild lock makes it impossible to trigger two resets at once.
- **`/status` is scoped to the application owner**, not per-server admins, because it's a bot-wide setting — one server shouldn't be able to change what every other server sees.
- **OTP codes expire (5 minutes) and rate-limit guesses (5 attempts)**, closing the door on brute-forcing the verification flow.
- **Tokens, passwords, and secrets are never logged** — the logger's contract explicitly excludes them, and none of the code paths that touch credentials pass them to a log call.

<br/>

## 🗂️ Project Structure

```
src/
├── commands/              Slash command definitions and their handlers
│   ├── setup.js           /setup preview & /setup server
│   ├── verify.js          /verify setup/panel/status
│   ├── otp.js              /otp <code>
│   ├── roles.js           /roles setup
│   ├── ticket.js          /ticket close/reopen/claim/delete/transcript/setup
│   ├── voice.js           /voice name/limit/lock/unlock/claim/kick/info
│   ├── config.js          /config view/set/staff-role
│   ├── status.js          /status set/clear
│   ├── stats.js           /stats refresh
│   └── help.js            /help
├── events/                discord.js Gateway event handlers
│   ├── ready.js           Applies stored bot status + first stats refresh on boot
│   ├── guildCreate.js     Greets a server the bot just joined
│   ├── guildMemberAdd.js / guildMemberRemove.js   Welcome/goodbye cards
│   ├── voiceStateUpdate.js  Temp voice creation & cleanup
│   └── interactionCreate.js  Central dispatcher for commands, buttons, selects
├── services/              Business logic — one file per domain
│   ├── serverSetup.js     Orchestrates the full /setup server flow
│   ├── verificationService.js   OTP generation, DM delivery, validation
│   ├── roleService.js     Role creation, self-role toggling, obsolete-role cleanup
│   ├── ticketService.js   Ticket panel, lifecycle, transcripts
│   ├── temporaryVoiceService.js  Room creation, ownership, auto-cleanup
│   ├── welcomeService.js  Canvas-rendered welcome/goodbye cards
│   ├── statsService.js    Computes & applies live Server Stats channel names
│   ├── configService.js   Per-guild + global config persistence
│   └── loggingService.js  Writes audit events to the guild's log channel
├── config/                Static, declarative configuration
│   ├── serverStructure.js   The entire category/channel tree + permission flags
│   ├── defaultConfig.js   Every configurable key and its default
│   ├── rulesContent.js    Default bilingual rules text
│   └── voiceGuideContent.js  Default bilingual /voice command guide
├── utils/                 Small, focused helpers
│   ├── logger.js          Console logging
│   ├── embeds.js          Embed builder shortcuts
│   ├── i18n.js            Bilingual text formatting (bi() / biTitle())
│   ├── permissions.js     Dangerous-permission guard, bot-owner check
│   ├── presence.js        Bot status/activity helpers
│   └── normalize.js       String/name utilities
├── index.js               Entry point — loads everything, logs in
└── deploy-commands.js     Registers slash commands with Discord
```

<br/>

## ❓ FAQ

**Why OTP instead of a simple "react to verify" button?**
A reaction or button click can be scripted by a raid bot in milliseconds. Requiring a code sent to a private DM means the verifying account has to actually be reachable and human-operated enough to check its own messages — a meaningfully higher bar with almost no added friction for real members.

**Why does `/status` only work for the bot owner, not server admins?**
A Discord bot has exactly *one* Gateway presence, shared identically across every server it's in. If any server's admin could change it, servers would effectively be fighting over the same status line. Scoping it to the application owner is the only version of this feature that makes sense for a multi-server bot.

**Can I run this on Node 16 or lower?**
No — the codebase uses ES Modules and `node:`-prefixed core imports throughout, both of which require Node 18+. Attempting to run it on an older runtime fails immediately at boot.

**Does it support servers other than the one I run `/setup server` in?**
Yes — nothing in the runtime is guild-specific. See [Publishing to Many Servers](#-publishing-to-many-servers).

**I changed `selfRoles.options` in `defaultConfig.js` — do I need to manually delete the old roles?**
No. The next time `/roles setup` or `/setup server` runs, any self-role that's no longer in the list gets deleted automatically.

<br/>

## 🤝 Contributing

Issues and pull requests are welcome. The codebase is intentionally kept flat and commented — every service does one thing, every non-obvious decision has a comment explaining *why*, not just *what*. If you're adding a feature, look for the closest existing service first; there's a good chance the pattern you need already exists somewhere in `src/services/`.

<br/>

## 📄 License

Released under the [MIT License](./LICENSE) — do whatever you want with it.

<div align="center">

<br/>

**Built for communities that deserve a server that runs itself.**

</div>
