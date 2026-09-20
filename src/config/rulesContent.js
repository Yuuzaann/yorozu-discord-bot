/**
 * Generic bilingual (Indonesian/English) server rules posted automatically
 * to the ☑️・rules channel when /setup server finishes. Editable per-guild
 * via /config set rules.content "<your own text>".
 */
export const DEFAULT_RULES = {
  title: '☑️ Peraturan Server / Server Rules',
  id: [
    '1. Hormati semua anggota. Dilarang toxic, rasis, SARA, atau ujaran kebencian.',
    '2. Dilarang spam, flood, atau iklan tanpa izin.',
    '3. Dilarang konten NSFW, kekerasan, atau ilegal.',
    '4. Gunakan setiap channel sesuai fungsinya.',
    '5. Dilarang menyebarkan data pribadi orang lain (doxxing).',
    '6. Wajib mengikuti Ketentuan Layanan & Pedoman Komunitas Discord.',
    '7. Keputusan staff bersifat final. Pelanggaran dapat berujung warning, mute, kick, atau ban.',
  ].join('\n'),
  en: [
    '1. Respect all members. No toxicity, racism, or hate speech.',
    '2. No spamming, flooding, or unsolicited advertising.',
    '3. No NSFW, violent, or illegal content.',
    '4. Use every channel for its intended purpose.',
    "5. No sharing others' personal information (doxxing).",
    "6. You must follow Discord's Terms of Service & Community Guidelines.",
    '7. Staff decisions are final. Violations may result in a warning, mute, kick, or ban.',
  ].join('\n'),
};
