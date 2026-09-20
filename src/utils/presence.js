import { ActivityType } from 'discord.js';

export const ACTIVITY_TYPE_CHOICES = [
  { name: 'Playing', value: 'playing' },
  { name: 'Watching', value: 'watching' },
  { name: 'Listening', value: 'listening' },
  { name: 'Competing', value: 'competing' },
  { name: 'Custom', value: 'custom' },
];

const ACTIVITY_TYPE_MAP = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

export const PRESENCE_CHOICES = [
  { name: 'Online', value: 'online' },
  { name: 'Idle', value: 'idle' },
  { name: 'Do Not Disturb', value: 'dnd' },
  { name: 'Invisible', value: 'invisible' },
];

/** Builds a discord.js activity object from our stored { type, text } shape. */
export function buildActivity(typeKey, text) {
  const type = ACTIVITY_TYPE_MAP[typeKey] ?? ActivityType.Playing;
  if (type === ActivityType.Custom) {
    // Custom-type activities show `state` as the text; `name` is required by
    // the API but not displayed for this type.
    return { name: 'Custom Status', type, state: text };
  }
  return { name: text, type };
}

/** Applies a stored status ({ type, text, presence } or null) to the client's Gateway presence. */
export function applyStoredStatus(client, status) {
  if (!status) {
    client.user.setPresence({ activities: [], status: 'online' });
    return;
  }
  client.user.setPresence({
    activities: [buildActivity(status.type, status.text)],
    status: status.presence ?? 'online',
  });
}
