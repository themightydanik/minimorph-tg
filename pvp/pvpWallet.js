// pvp/pvpWallet.js
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { createBattle, getBattleById, updateBattle } from "./pvpFirebase.js";
import { startBattle } from "./pvp/pvpGameLogic.js";

export function initPvpWalletLogic({ bot, db }) {

  bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const prizePool = parseInt(ctx.match[1]);
    const initiator = ctx.from;

    // Создаем батл в Firebase
    const battle = await createBattle(db, initiator, prizePool);

    if (prizePool === 0) {
      // Игра без призового пула
      await updateBattle(db, battle.id, {
        initiatorPaid: true,
        opponentPaid: true,
        status: "ready_to_start",
        turn: "initiator"
      });
      await ctx.reply(`🎯 Battle created without prize pool! @${initiator.username} can start playing immediately.`);
      return;
    }

    // Игра с призовым пулом — показываем инфо для пополнения кошелька
    await ctx.reply(
      `💡 PvP Battle created with prize pool ${prizePool} ⭐.\n` +
      `Each player must fund at least ${prizePool / 2} ⭐ to start.\n` +
      `Use buttons below to top up your wallet.`,
      {
        reply_markup: {
          inline_keyboard: [
            [
              { text: "💎 Add 1 ⭐", callback_data: `wallet_add_${battle.id}_1` },
              { text: "💎 Add 125 ⭐", callback_data: `wallet_add_${battle.id}_125` },
              { text: "💎 Add 250 ⭐", callback_data: `wallet_add_${battle.id}_250` },
            ],
            [
              { text: "✅ Pay for Battle", callback_data: `battle_pay_${battle.id}` }
            ]
          ]
        }
      }
    );
  });

  // Пополнение кошелька
  bot.action(/^wallet_add_(.+)_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const amount = parseInt(ctx.match[2]);
    const userId = ctx.from.id.toString();

    const userRef = doc(db, "users", userId);
    const snap = await getDoc(userRef);
    const wallet = snap.exists() ? (snap.data().wallet || 0) : 0;
    await updateDoc(userRef, { wallet: wallet + amount });

    await ctx.reply(`💰 Wallet topped up: +${amount} ⭐. Current balance: ${wallet + amount} ⭐`);
  });

  // Оплата участия в батле через кошелек
  bot.action(/^battle_pay_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    const userId = ctx.from.id.toString();
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    const wallet = userSnap.exists() ? (userSnap.data().wallet || 0) : 0;
    const required = battle.prizePool / 2;

    if (wallet < required) return ctx.reply(`⚠️ Not enough balance. You need at least ${required} ⭐.`);

    await updateDoc(userRef, { wallet: wallet - required });

    if (userId == battle.initiatorId.toString()) {
      await updateBattle(db, battleId, { initiatorPaid: true });
    } else if (userId == battle.opponentId.toString()) {
      await updateBattle(db, battleId, { opponentPaid: true });
    }

    await ctx.reply(`✅ Payment confirmed for battle!`);

    // Если оба заплатили — стартуем батл
    const updated = await getBattleById(db, battleId);
    if (updated.initiatorPaid && updated.opponentPaid) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(bot, db, battleId);
    }
  });

}
