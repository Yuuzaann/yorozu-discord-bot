import { EmbedBuilder } from 'discord.js';

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  info: 0x5865f2,
};

function base(color) {
  return new EmbedBuilder().setColor(color).setTimestamp();
}

export function infoEmbed(title, description) {
  return base(COLORS.info).setTitle(title).setDescription(description ?? null);
}

export function successEmbed(title, description) {
  return base(COLORS.success).setTitle(title).setDescription(description ?? null);
}

export function errorEmbed(title, description) {
  return base(COLORS.danger).setTitle(title).setDescription(description ?? null);
}

export function warningEmbed(title, description) {
  return base(COLORS.warning).setTitle(title).setDescription(description ?? null);
}

export function primaryEmbed(title, description) {
  return base(COLORS.primary).setTitle(title).setDescription(description ?? null);
}
