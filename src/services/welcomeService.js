import { AttachmentBuilder } from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { applyTemplate } from '../utils/normalize.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('WelcomeService');

const CARD_WIDTH = 900;
const CARD_HEIGHT = 300;
const AVATAR_SIZE = 180;

/**
 * Renders a Koya-bot-style banner: gradient background, circular avatar with
 * a colored ring, big headline (WELCOME/GOODBYE), username, and a subtitle
 * (member count / server name). Returns a PNG Buffer.
 */
async function renderCard({ avatarUrl, headline, username, subtitle, accentColor }) {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
  gradient.addColorStop(0, '#1b1f38');
  gradient.addColorStop(1, '#2d1b4e');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // Decorative accent bar
  ctx.fillStyle = accentColor;
  ctx.fillRect(0, CARD_HEIGHT - 10, CARD_WIDTH, 10);

  // Avatar (circular, ringed)
  const avatarX = 70;
  const avatarY = CARD_HEIGHT / 2 - AVATAR_SIZE / 2;
  try {
    const avatar = await loadImage(avatarUrl);
    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2 + 6, 0, Math.PI * 2);
    ctx.fillStyle = accentColor;
    ctx.fill();
    ctx.closePath();

    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, AVATAR_SIZE, AVATAR_SIZE);
    ctx.restore();
  } catch (err) {
    logger.warn('Failed to load avatar for card, drawing placeholder circle', err.message);
    ctx.beginPath();
    ctx.arc(avatarX + AVATAR_SIZE / 2, avatarY + AVATAR_SIZE / 2, AVATAR_SIZE / 2, 0, Math.PI * 2);
    ctx.fillStyle = '#4b4f7a';
    ctx.fill();
  }

  // Text block
  const textX = avatarX + AVATAR_SIZE + 50;

  ctx.fillStyle = accentColor;
  ctx.font = 'bold 46px sans-serif';
  ctx.fillText(headline, textX, 120);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 38px sans-serif';
  ctx.fillText(truncate(username, 22), textX, 175);

  ctx.fillStyle = '#c9c9e8';
  ctx.font = '24px sans-serif';
  ctx.fillText(subtitle, textX, 215);

  return canvas.encode('png');
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

class WelcomeService {
  _findChannel(guild, name) {
    return guild.channels.cache.find((c) => c.name.toLowerCase().includes(name.toLowerCase())) ?? null;
  }

  async sendWelcome(member, config) {
    if (!config.welcome.enabled) return;
    const guild = member.guild;
    const channel = this._findChannel(guild, config.welcome.channelName);
    if (!channel || !channel.isTextBased()) return;

    const text = applyTemplate(config.welcome.message, {
      user: `<@${member.id}>`,
      username: member.user.username,
      server: guild.name,
      membercount: guild.memberCount,
    });

    const payload = { content: text };
    if (config.welcome.useCard) {
      try {
        const buffer = await renderCard({
          avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
          headline: 'WELCOME',
          username: member.user.username,
          subtitle: `Member #${guild.memberCount} • ${guild.name}`,
          accentColor: '#57f287',
        });
        payload.files = [new AttachmentBuilder(buffer, { name: 'welcome.png' })];
      } catch (err) {
        logger.error('Failed to render welcome card, sending text only', err.message);
      }
    }

    await channel.send(payload).catch((err) => logger.error('Failed to send welcome message', err.message));
  }

  async sendGoodbye(member, config) {
    if (!config.goodbye.enabled) return;
    const guild = member.guild;
    const channel = this._findChannel(guild, config.goodbye.channelName);
    if (!channel || !channel.isTextBased()) return;

    const text = applyTemplate(config.goodbye.message, {
      user: `<@${member.id}>`,
      username: member.user.username,
      server: guild.name,
      membercount: guild.memberCount,
    });

    const payload = { content: text };
    if (config.goodbye.useCard) {
      try {
        const buffer = await renderCard({
          avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 256 }),
          headline: 'GOODBYE',
          username: member.user.username,
          subtitle: `Now ${guild.memberCount} members • ${guild.name}`,
          accentColor: '#ed4245',
        });
        payload.files = [new AttachmentBuilder(buffer, { name: 'goodbye.png' })];
      } catch (err) {
        logger.error('Failed to render goodbye card, sending text only', err.message);
      }
    }

    await channel.send(payload).catch((err) => logger.error('Failed to send goodbye message', err.message));
  }
}

export const welcomeService = new WelcomeService();
