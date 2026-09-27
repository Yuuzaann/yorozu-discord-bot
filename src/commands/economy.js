import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../utils/embeds.js';
import { bi, biTitle } from '../utils/i18n.js';
import { formatDuration } from '../utils/normalize.js';
import { isAdmin } from '../utils/permissions.js';
import { configService } from '../services/configService.js';
import { economyService } from '../services/economyService.js';

export const data = new SlashCommandBuilder()
  .setName('economy')
  .setDescription('Virtual currency: balance, daily/work rewards, pay, bank, leaderboard, shop')
  .addSubcommand((sub) =>
    sub.setName('balance').setDescription('Check your (or someone else\'s) balance').addUserOption((o) => o.setName('user').setDescription('Whose balance to check'))
  )
  .addSubcommand((sub) => sub.setName('daily').setDescription('Claim your daily reward'))
  .addSubcommand((sub) => sub.setName('work').setDescription('Work for a random amount of coins'))
  .addSubcommand((sub) =>
    sub
      .setName('pay')
      .setDescription('Send coins to another member')
      .addUserOption((o) => o.setName('user').setDescription('Who to pay').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How much to send').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub.setName('deposit').setDescription('Move coins from wallet to bank (safer from being paid away by mistake)').addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) =>
    sub.setName('withdraw').setDescription('Move coins from bank back to wallet').addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
  )
  .addSubcommand((sub) => sub.setName('leaderboard').setDescription('Show the richest members in this server'))
  .addSubcommand((sub) => sub.setName('shop').setDescription('View items available for purchase'))
  .addSubcommand((sub) => sub.setName('buy').setDescription('Buy a shop item').addStringOption((o) => o.setName('item').setDescription('Item ID (see /economy shop)').setRequired(true)))
  .addSubcommandGroup((group) =>
    group
      .setName('admin')
      .setDescription('Admin economy tools')
      .addSubcommand((sub) =>
        sub
          .setName('give')
          .setDescription('Add coins to a member\'s wallet')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
      )
      .addSubcommand((sub) =>
        sub
          .setName('take')
          .setDescription('Remove coins from a member\'s wallet')
          .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
          .addIntegerOption((o) => o.setName('amount').setDescription('Amount').setRequired(true).setMinValue(1))
      )
      .addSubcommand((sub) =>
        sub.setName('reset').setDescription('Reset a member\'s economy account back to the starting balance').addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true))
      )
  );

function formatAmount(amount, config) {
  return `${config.economy.currencySymbol} ${amount.toLocaleString('en-US')} ${config.economy.currencyName}`;
}

export async function execute(interaction) {
  const config = await configService.getGuildConfig(interaction.guild.id);

  if (!config.economy.enabled) {
    await interaction.reply({
      embeds: [errorEmbed(biTitle('Dinonaktifkan', 'Disabled'), bi('Fitur ekonomi dinonaktifkan untuk server ini.', 'The economy feature is disabled for this server.'))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (group === 'admin') {
    if (!isAdmin(interaction.member)) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Akses ditolak', 'Access denied'), bi('Hanya Administrator yang dapat menggunakan /economy admin.', 'Only Administrators can use /economy admin.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const targetUser = interaction.options.getUser('user', true);

    if (sub === 'give') {
      const amount = interaction.options.getInteger('amount', true);
      const account = await economyService.adminGive(interaction.guild.id, targetUser.id, amount, config);
      await interaction.reply({
        embeds: [successEmbed(biTitle('Diberikan', 'Given'), bi(`Diberikan ${formatAmount(amount, config)} ke ${targetUser}. Saldo sekarang: ${formatAmount(account.wallet, config)}.`, `Gave ${formatAmount(amount, config)} to ${targetUser}. New balance: ${formatAmount(account.wallet, config)}.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'take') {
      const amount = interaction.options.getInteger('amount', true);
      const account = await economyService.adminTake(interaction.guild.id, targetUser.id, amount, config);
      await interaction.reply({
        embeds: [successEmbed(biTitle('Diambil', 'Taken'), bi(`Diambil ${formatAmount(amount, config)} dari ${targetUser}. Saldo sekarang: ${formatAmount(account.wallet, config)}.`, `Took ${formatAmount(amount, config)} from ${targetUser}. New balance: ${formatAmount(account.wallet, config)}.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === 'reset') {
      await economyService.adminReset(interaction.guild.id, targetUser.id, config);
      await interaction.reply({
        embeds: [successEmbed(biTitle('Direset', 'Reset'), bi(`Akun ekonomi ${targetUser} dikembalikan ke saldo awal.`, `${targetUser}'s economy account has been reset to the starting balance.`))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    return;
  }

  if (sub === 'balance') {
    const targetUser = interaction.options.getUser('user') ?? interaction.user;
    const account = await economyService.getAccount(interaction.guild.id, targetUser.id, config);
    await interaction.reply({
      embeds: [
        infoEmbed(biTitle(`💰 Saldo ${targetUser.username}`, `${targetUser.username}'s Balance`), null).addFields(
          { name: 'Dompet / Wallet', value: formatAmount(account.wallet, config), inline: true },
          { name: 'Bank', value: formatAmount(account.bank, config), inline: true },
          { name: 'Total', value: formatAmount(account.wallet + account.bank, config), inline: true }
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'daily') {
    const result = await economyService.claimDaily(interaction.guild.id, interaction.user.id, config);
    if (!result.success) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            biTitle('Sudah diklaim', 'Already claimed'),
            bi(`Kamu sudah klaim hari ini. Coba lagi dalam ${formatDuration(result.remainingMs)}.`, `You've already claimed today. Try again in ${formatDuration(result.remainingMs)}.`)
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [
        successEmbed(
          biTitle('🎁 Daily Reward', 'Daily Reward'),
          bi(`Kamu dapat ${formatAmount(result.amount, config)}! Streak: ${result.streak} hari berturut-turut.`, `You received ${formatAmount(result.amount, config)}! Streak: ${result.streak} day(s) in a row.`)
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'work') {
    const result = await economyService.work(interaction.guild.id, interaction.user.id, config);
    if (!result.success) {
      await interaction.reply({
        embeds: [
          warningEmbed(
            biTitle('Masih lelah', 'Still tired'),
            bi(`Kamu baru saja kerja. Coba lagi dalam ${formatDuration(result.remainingMs)}.`, `You just worked. Try again in ${formatDuration(result.remainingMs)}.`)
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [successEmbed(biTitle('💼 Kerja selesai', 'Work complete'), bi(`Kamu dapat ${formatAmount(result.amount, config)}.`, `You earned ${formatAmount(result.amount, config)}.`))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'pay') {
    const targetUser = interaction.options.getUser('user', true);
    const amount = interaction.options.getInteger('amount', true);

    if (targetUser.id === interaction.user.id) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Tidak bisa', "Can't do that"), bi('Kamu tidak bisa membayar diri sendiri.', "You can't pay yourself."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (targetUser.bot) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Tidak bisa', "Can't do that"), bi('Kamu tidak bisa membayar bot.', "You can't pay a bot."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const result = await economyService.transfer(interaction.guild.id, interaction.user.id, targetUser.id, amount, config);
    if (!result.success) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Saldo tidak cukup', 'Insufficient balance'), bi('Saldo dompet kamu tidak cukup.', "Your wallet balance isn't enough."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [successEmbed(biTitle('💸 Pembayaran berhasil', 'Payment sent'), bi(`${interaction.user} membayar ${formatAmount(amount, config)} ke ${targetUser}.`, `${interaction.user} paid ${formatAmount(amount, config)} to ${targetUser}.`))],
    });
    return;
  }

  if (sub === 'deposit') {
    const amount = interaction.options.getInteger('amount', true);
    const result = await economyService.deposit(interaction.guild.id, interaction.user.id, amount, config);
    if (!result.success) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Saldo tidak cukup', 'Insufficient balance'), bi('Saldo dompet kamu tidak cukup.', "Your wallet balance isn't enough."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [successEmbed(biTitle('🏦 Disetor', 'Deposited'), bi(`${formatAmount(amount, config)} dipindahkan ke bank.`, `${formatAmount(amount, config)} moved to your bank.`))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'withdraw') {
    const amount = interaction.options.getInteger('amount', true);
    const result = await economyService.withdraw(interaction.guild.id, interaction.user.id, amount, config);
    if (!result.success) {
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Saldo bank tidak cukup', 'Insufficient bank balance'), bi('Saldo bank kamu tidak cukup.', "Your bank balance isn't enough."))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      embeds: [successEmbed(biTitle('🏦 Ditarik', 'Withdrawn'), bi(`${formatAmount(amount, config)} dipindahkan ke dompet.`, `${formatAmount(amount, config)} moved to your wallet.`))],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === 'leaderboard') {
    const top = await economyService.leaderboard(interaction.guild.id, 10);
    if (top.length === 0) {
      await interaction.reply({ embeds: [infoEmbed(biTitle('🏆 Leaderboard', 'Leaderboard'), bi('Belum ada data.', 'No data yet.'))] });
      return;
    }
    const lines = await Promise.all(
      top.map(async (entry, i) => {
        const user = await interaction.client.users.fetch(entry.userId).catch(() => null);
        const name = user ? user.username : `<@${entry.userId}>`;
        return `**${i + 1}.** ${name} — ${formatAmount(entry.total, config)}`;
      })
    );
    await interaction.reply({ embeds: [infoEmbed(biTitle('🏆 Leaderboard', 'Leaderboard'), lines.join('\n'))] });
    return;
  }

  if (sub === 'shop') {
    if (config.economy.shop.length === 0) {
      await interaction.reply({ embeds: [infoEmbed(biTitle('🛒 Shop', 'Shop'), bi('Belum ada item di shop.', 'No items in the shop yet.'))] });
      return;
    }
    const embed = infoEmbed(
      biTitle('🛒 Shop', 'Shop'),
      bi('Gunakan `/economy buy item:<id>` untuk membeli.', 'Use `/economy buy item:<id>` to purchase.')
    ).addFields(config.economy.shop.map((item) => ({ name: `${item.name} — ${formatAmount(item.price, config)}`, value: `ID: \`${item.id}\`` })));
    await interaction.reply({ embeds: [embed] });
    return;
  }

  if (sub === 'buy') {
    const itemId = interaction.options.getString('item', true);
    const result = await economyService.buyItem(interaction.guild.id, interaction.user.id, itemId, config, interaction.guild);

    if (!result.success) {
      const reasons = {
        not_found: bi('Item tidak ditemukan. Cek `/economy shop` untuk daftar ID yang benar.', 'Item not found. Check `/economy shop` for valid IDs.'),
        insufficient: bi('Saldo dompet kamu tidak cukup untuk item ini.', "Your wallet balance isn't enough for this item."),
        already_owned: bi('Kamu sudah punya item ini.', 'You already own this item.'),
        role_missing: bi('Role untuk item ini sudah tidak ada. Hubungi admin.', "This item's role no longer exists. Contact an admin."),
        unsafe_role: bi('Item ini dikonfigurasi tidak aman dan diblokir. Hubungi admin.', 'This item is configured unsafely and was blocked. Contact an admin.'),
      };
      await interaction.reply({
        embeds: [errorEmbed(biTitle('Gagal membeli', 'Purchase failed'), reasons[result.reason] ?? bi('Gagal membeli item.', 'Failed to purchase item.'))],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [successEmbed(biTitle('✅ Dibeli', 'Purchased'), bi(`Kamu membeli **${result.item.name}**.`, `You purchased **${result.item.name}**.`))],
      flags: MessageFlags.Ephemeral,
    });
  }
}
