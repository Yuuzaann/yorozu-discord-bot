/** Lowercases and strips non-alphanumeric characters for loose name comparisons. */
export function normalizeName(name) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
}

/** Sanitizes arbitrary user-provided text for use as a channel name. */
export function toChannelSafeName(text, fallback = 'channel') {
  const cleaned = text
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9\-_・]/gi, '')
    .slice(0, 90);
  return cleaned.length > 0 ? cleaned : fallback;
}

/** Formats milliseconds as mm:ss or hh:mm:ss. */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '00:00';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/** Builds a template string, e.g. applyTemplate("{username}'s Room", { username: "Yuuzan" }). */
export function applyTemplate(template, values) {
  return template.replace(/\{(\w+)\}/g, (_, key) => (key in values ? String(values[key]) : `{${key}}`));
}
