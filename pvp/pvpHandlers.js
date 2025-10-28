import { createBattle, getBattleById, updateBattle } from "./pvpFirebase.js";
import { sendPaymentRequest } from "./pvpPayments.js";

// --- Экспортируем функцию, чтобы можно было вызвать из index.js ---
export async function showBattlePrizePool(ctx) {
  const user = ctx.from;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "💰 Prize Pool: 120 ⭐", callback_data: "pvp_prize_120" },
        { text: "💰 Prize Pool: 250 ⭐", callback_data: "pvp_prize_250" },
      ],
      [{ text: "💎 Prize Pool: 500 ⭐", callback_data: "pvp_prize_500" }],
    ],
  };
  await ctx.reply(
    `⚔️ @${user.username || user.first_name}, choose your prize pool:`,
    { reply_markup: keyboard }
  );
}

export default function initPvpHandlers({ bot, db }) {
  // --- команда /battle теперь просто вызывает ту же функцию ---
  bot.command("battle", async (ctx) => {
    await showBattlePrizePool(ctx);
  });

  // --- дальше все остальные action остаются без изменений ---
  bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const prizePool = parseInt(ctx.match[1]);
    const initiator = ctx.from;

    const battle = await createBattle(db, initiator, prizePool);

    const acceptKeyboard = {
      inline_keyboard: [
        [{ text: "✅ Accept Battle", callback_data: `pvp_accept_${battle.id}` }],
      ],
    };

    await ctx.reply(
      `🎯 @${initiator.username || initiator.first_name} has created a battle!\n\nPrize fund: ${prizePool} ⭐\n( ${prizePool / 2} ⭐ from each player)\n\nWaiting for the opponent...`,
      { reply_markup: acceptKeyboard }
    );
  });

  bot.action(/^pvp_accept_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const opponent = ctx.from;

    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ This battle is no longer active.");
    if (battle.status !== "awaiting_accept") return ctx.reply("⚠️ The battle has already started or completed.");

    await updateBattle(db, battleId, {
      opponentId: opponent.id,
      opponentUsername: opponent.username,
      status: "awaiting_payment_initiator",
    });

    await sendPaymentRequest(ctx, battleId, "initiator", battle.prizePool / 2);

    await ctx.reply(
      `💡 @${opponent.username}, We're waiting for the organizer's payment. After that, you can pay for your participation and start the battle.`
    );
  });
}
