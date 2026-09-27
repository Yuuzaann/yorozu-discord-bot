/**
 * Guide for the /voice command family, posted automatically to every
 * "〔✨〕 INTERFACE" channel by /setup server. Indonesian and English are
 * kept as two separate full blocks (matches DEFAULT_RULES in
 * rulesContent.js) rather than interleaved line-by-line, so serverSetup.js
 * can post them as two embed fields: '🇮🇩 Bahasa Indonesia' then '🇬🇧 English'.
 */
export const VOICE_GUIDE = {
  title: '🎧 Panduan Voice Room / Voice Room Guide',
  id: [
    'Masuk ke channel **〔➕〕 JOIN TO CREATE** untuk otomatis membuat room voice pribadi milikmu. Command di bawah hanya berlaku selagi kamu berada di dalam room voice sementara milikmu sendiri.',
    '',
    '**/voice name <nama>** — Ganti nama room kamu.',
    '**/voice limit <0-99>** — Atur batas jumlah member (0 = tanpa batas).',
    '**/voice lock** — Kunci room supaya orang lain tidak bisa masuk.',
    '**/voice unlock** — Buka kunci room lagi.',
    '**/voice claim** — Ambil alih kepemilikan room kalau owner sebelumnya sudah keluar.',
    '**/voice kick <user>** — Keluarkan member tertentu dari room kamu.',
    '**/voice info** — Lihat info room: owner, jumlah member, dan limit saat ini.',
    '',
    'Room otomatis terhapus begitu kosong.',
  ].join('\n'),
  en: [
    'Join **〔➕〕 JOIN TO CREATE** to automatically get your own personal voice room. The commands below only work while you are inside your own temporary voice room.',
    '',
    '**/voice name <name>** — Rename your room.',
    '**/voice limit <0-99>** — Set the member limit (0 = unlimited).',
    '**/voice lock** — Lock the room so others can\'t join.',
    '**/voice unlock** — Unlock the room again.',
    '**/voice claim** — Take over ownership of the room if the previous owner has left.',
    '**/voice kick <user>** — Remove a specific member from your room.',
    '**/voice info** — View room info: owner, member count, and current limit.',
    '',
    'The room is automatically deleted once empty.',
  ].join('\n'),
};
