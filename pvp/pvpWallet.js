// pvp/pvpWallet.js
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getBattleById, updateBattle } from "./pvpFirebase.js";
import { startBattle } from "./pvpGameLogic.js";

export function initPvpWalletLogic({ bot, db }) {
  bot.db = db;

  // === Пополнение Wallet в боте ===
  bot.action(/^wallet_topup$/, async (ctx) => {
    await ctx.answerCbQuery();
    const keyboard = {
      inline_keyboard: [
        [{ text: "Add 1 ⭐", callback_data: "wallet_add_1" }],
        [{ text: "Add 125 ⭐", callback_data: "wallet_add_125" }],
        [{ text: "Add 250 ⭐", callback_data: "wallet_add_250" }],
      ],
    };
    await ctx.reply("💰 Choose amount to add to your Wallet:", { reply_markup: keyboard });
  });

  bot.action(/^wallet_add_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1]);
    const userRef = doc(db, "users", ctx.from.id.toString());
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      await updateDoc(userRef, { wallet: amount });
    } else {
      const data = userSnap.data();
      await updateDoc(userRef, { wallet: (data.wallet || 0) + amount });
    }

    await ctx.reply(`✅ Added ${amount} ⭐ to your Wallet! Current balance updated.`);
  });

  // === Оплата батла из Wallet ===
  bot.action(/^pvp_pay_wallet_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    const userRef = doc(db, "users", ctx.from.id.toString());
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists() || (userSnap.data().wallet || 0) < battle.prizePool / 2) {
      return ctx.reply("⚠️ Not enough balance in Wallet. Please top up first.");
    }

    // Списываем средства и отмечаем оплату
    const amount = battle.prizePool / 2;
    await updateDoc(userRef, { wallet: userSnap.data().wallet - amount });

    const updateData = {};
    if (ctx.from.id === battle.initiatorId) updateData.initiatorPaid = true;
    if (ctx.from.id === battle.opponentId) updateData.opponentPaid = true;
    await updateBattle(db, battleId, updateData);

    await ctx.reply(`✅ Paid ${amount} ⭐ from Wallet!`);

    // Если оба оплатили — запускаем батл
    const updatedBattle = await getBattleById(db, battleId);
    if ((updatedBattle.initiatorPaid && updatedBattle.opponentPaid) ||
        updatedBattle.prizePool === 0) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(bot, db, battleId);
    }
  });
}
