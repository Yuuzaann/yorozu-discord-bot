/**
 * Bilingual (Indonesian/English) guide for the /voice command family,
 * posted automatically to every "✨・interface" channel by /setup server.
 */
export const VOICE_GUIDE = {
  title: '🎧 Panduan Voice Room / Voice Room Guide',
  description:
    'Masuk ke channel **➕・Join to Create** untuk otomatis membuat room voice pribadi milikmu. Command di bawah hanya berlaku selagi kamu berada di dalam room voice sementara milikmu sendiri.\n' +
    'Join **➕・Join to Create** to automatically get your own personal voice room. The commands below only work while you are inside your own temporary voice room.',
  commands: [
    {
      usage: '/voice name <nama>',
      id: 'Ganti nama room kamu.',
      en: 'Rename your room.',
    },
    {
      usage: '/voice limit <0-99>',
      id: 'Atur batas jumlah member (0 = tanpa batas).',
      en: 'Set the member limit (0 = unlimited).',
    },
    {
      usage: '/voice lock',
      id: 'Kunci room supaya orang lain tidak bisa masuk.',
      en: "Lock the room so others can't join.",
    },
    {
      usage: '/voice unlock',
      id: 'Buka kunci room lagi.',
      en: 'Unlock the room again.',
    },
    {
      usage: '/voice claim',
      id: 'Ambil alih kepemilikan room kalau owner sebelumnya sudah keluar.',
      en: 'Take over ownership of the room if the previous owner has left.',
    },
    {
      usage: '/voice kick <user>',
      id: 'Keluarkan member tertentu dari room kamu.',
      en: 'Remove a specific member from your room.',
    },
    {
      usage: '/voice info',
      id: 'Lihat info room: owner, jumlah member, dan limit saat ini.',
      en: 'View room info: owner, member count, and current limit.',
    },
  ],
  footer: 'Room otomatis terhapus begitu kosong. / The room is automatically deleted once empty.',
};
