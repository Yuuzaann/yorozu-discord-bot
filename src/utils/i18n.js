/**
 * Formats a bilingual (Indonesian + English) string for embeds and replies.
 * Every user-facing message in this bot goes through this so the server
 * stays usable for both Indonesian and English-speaking members.
 */
export function bi(id, en) {
  return `🇮🇩 ${id}\n🇬🇧 ${en}`;
}

/** Bilingual title: "Indonesian / English". */
export function biTitle(id, en) {
  return `${id} / ${en}`;
}
