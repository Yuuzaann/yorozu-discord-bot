import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { errorEmbed, infoEmbed, successEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { temporaryVoiceService } from '../services/temporaryVoiceService.js';

export const data = new SlashCommandBuilder()
  .setName('voice')
  .setDescription('Manage your temporary voice room')
  .addSubcommand((sub) =>
    sub.setName('name').setDescription('Rename your room').addStringOption((o) => o.setName('value').setDescription('New name').setRequired(true))
  )
  .addSubcommand((sub) =>
    sub.setName('limit').setDescription('Set user limit').addIntegerOption((o) => o.setName('value').setDescription('0 = unlimited').setMinValue(0).setMaxValue(99).setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('lock').setDescription('Lock your room'))
  .addSubcommand((sub) => sub.setName('unlock').setDescription('Unlock your room'))
  .addSubcommand((sub) => sub.setName('claim').setDescription('Claim an ownerless room'))
  .addSubcommand((sub) =>
    sub.setName('kick').setDescription('Kick a member from your room').addUserOption((o) => o.setName('user').setDescription('Member to kick').setRequired(true))
  )
  .addSubcommand((sub) => sub.setName('info').setDescription('Show room info'));

function getMemberVoiceChannel(interaction) {
  return interaction.member.voice?.channel ?? null;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const channel = getMemberVoiceChannel(interaction);

  if (!channel || !temporaryVoiceService.isManaged(channel.id)) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          biTitle('Bukan room sementara', 'No temporary room'),
          bi('Kamu harus berada di room voice sementara untuk menggunakan command ini.', 'You must be in a temporary voice room to use this command.')
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const ownerId = temporaryVoiceService.getOwner(channel.id);
  const isOwner = ownerId === interaction.user.id;

  if (sub === 'claim') {
    const ownerStillPresent = ownerId && channel.members.has(ownerId);
    if (ownerStillPresent) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Room masih ada pemiliknya', 'Room has an owner'), bi('Pemilik saat ini masih ada di dalam room.', 'The current owner is still in the room.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await temporaryVoiceService.transferOwnership(channel.id, interaction.user.id);
    await channel.permissionOverwrites.edit(interaction.user.id, {
      ManageChannels: true,
      MoveMembers: true,
      ViewChannel: true,
      Connect: true,
    });
    await interaction.reply({
      embeds: [successEmbed(biTitle('Room diklaim', 'Room claimed'), bi('Kamu sekarang pemilik room ini.', 'You are now the owner of this room.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'info') {
    await interaction.reply({
      embeds: [
        infoEmbed(biTitle('Info room', 'Room info'), null).addFields(
          { name: 'Owner', value: ownerId ? `<@${ownerId}>` : 'Tidak ada / None', inline: true },
          { name: 'Members', value: String(channel.members.size), inline: true },
          { name: 'Limit', value: String(channel.userLimit || 'Unlimited'), inline: true }
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isOwner) {
    await interaction.reply({
      embeds: [
        errorEmbed(
          biTitle('Bukan pemilik', 'Not the owner'),
          bi('Hanya pemilik room yang bisa melakukan ini. Gunakan /voice claim kalau pemiliknya sudah keluar.', 'Only the room owner can do this. Use /voice claim if the owner has left.')
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'name') {
    const value = interaction.options.getString('value', true).slice(0, 95);
    await channel.setName(`🔊・${value}`);
    await interaction.reply({
      embeds: [successEmbed(biTitle('Diganti nama', 'Renamed'), `Room diganti nama jadi / Room renamed to 🔊・${value}`)],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'limit') {
    const value = interaction.options.getInteger('value', true);
    await channel.setUserLimit(value);
    await interaction.reply({
      embeds: [
        successEmbed(
          biTitle('Limit diatur', 'Limit set'),
          `Batas user diatur ke / User limit set to ${value === 0 ? 'tanpa batas / unlimited' : value}`
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'lock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false });
    await interaction.reply({
      embeds: [successEmbed(biTitle('Dikunci', 'Locked'), bi('Room sekarang terkunci.', 'Room is now locked.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'unlock') {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true });
    await interaction.reply({
      embeds: [successEmbed(biTitle('Dibuka', 'Unlocked'), bi('Room sekarang terbuka.', 'Room is now unlocked.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'kick') {
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member?.voice?.channelId || member.voice.channelId !== channel.id) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Tidak ada di room', 'Not in room'), bi('User itu tidak ada di room kamu.', 'That user is not in your room.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await member.voice.disconnect('Kicked by room owner');
    await interaction.reply({
      embeds: [successEmbed(biTitle('Dikeluarkan', 'Kicked'), `${user.tag} dikeluarkan dari room. / was removed from the room.`)],
      flags: MessageFlags.Ephemeral,
    });
  }
}
