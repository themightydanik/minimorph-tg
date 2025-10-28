// pvp/pvpWallet.js
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { createBattle, getBattleById, updateBattle } from "./pvpFirebase.js";

export function initPvpWalletLogic({ bot, db }) {
  bot.db = db;

  // Кнопки пополнения кошелька через Telegram Stars
  bot.action(/^wallet_topup$/, async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = {
      inline_keyboard: [
        [{ text: "Add 1 Star", callback_data: "wallet_add_1" }],
        [{ text: "Add 125 Stars", callback_data: "wallet_add_125" }],
        [{ text: "Add 250 Stars", callback_data: "wallet_add_250" }],
      ]
    };
    await ctx.reply("💳 Choose how many Stars to add to your internal Wallet:", { reply_markup: keyboard });
  });

  // Обработка кнопок выбора количества
  bot.action(/^wallet_add_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1], 10);
    const userRef = doc(db, "users", ctx.from.id.toString());
    const userSnap = await getDoc(userRef);

    let currentWallet = 0;
    if (userSnap.exists()) {
      currentWallet = userSnap.data().wallet || 0;
    }

    await updateDoc(userRef, {
      wallet: currentWallet + amount
    });

    await ctx.reply(`✅ Added ${amount} Stars to your Wallet. Current balance: ${currentWallet + amount} ⭐`);
  });

  // Кнопка оплаты батла через Wallet
  bot.action(/^pvp_pay_wallet_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    const userRef = doc(db, "users", ctx.from.id.toString());
    const userSnap = await getDoc(userRef);
    const wallet = (userSnap.exists() ? userSnap.data().wallet : 0) || 0;

    const cost = battle.prizePool / 2;
    if (wallet < cost) return ctx.reply(`⚠️ Not enough Stars in Wallet. Required: ${cost} ⭐, you have: ${wallet} ⭐`);

    // Списываем со счета
    await updateDoc(userRef, { wallet: wallet - cost });

    // Обновляем батл
    if (ctx.from.id === battle.initiatorId) {
      await updateBattle(db, battleId, { initiatorPaid: true });
    } else if (ctx.from.id === battle.opponentId) {
      await updateBattle(db, battleId, { opponentPaid: true });
    } else {
      return ctx.reply("⚠️ You are not part of this battle.");
    }

    await ctx.reply(`✅ Payment of ${cost} ⭐ successful! Your new Wallet balance: ${wallet - cost} ⭐`);

    // Если оплатили оба, стартуем батл
    const updated = await getBattleById(db, battleId);
    if (updated.initiatorPaid && updated.opponentPaid) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(bot, db, battleId);
    }
  });
}
