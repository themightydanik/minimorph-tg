import { createBattle, getBattleById, updateBattle } from "./pvpFirebase.js";
import { sendPaymentRequest } from "./pvpPayments.js";

export async function showBattlePrizePool(ctx) {
  const user = ctx.from;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "💰 Prize Pool: 2 ⭐", callback_data: "pvp_prize_2" },
        { text: "💰 Prize Pool: 250 ⭐", callback_data: "pvp_prize_250" },
      ],
      [{ text: "💎 Prize Pool: 500 ⭐", callback_data: "pvp_prize_500" }],
    ],
  };
  await ctx.reply(`⚔️ @${user.username || user.first_name}, choose your prize pool:`, { reply_markup: keyboard });
}

export default function initPvpHandlers({ bot, db }) {
  // === /battle command ===
  bot.command("battle", showBattlePrizePool);

  // === Callback для кнопки "Start Battle" в меню ===
  bot.action("start_battle", async (ctx) => {
    await ctx.answerCbQuery();
    await showBattlePrizePool(ctx);
  });

  // === Callback для выбора призового фонда ===
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
      `🎯 @${initiator.username || initiator.first_name} has created a battle!\nPrize fund: ${prizePool} ⭐\n( ${prizePool / 2} ⭐ from each player)\nWaiting for the opponent...`,
      { reply_markup: acceptKeyboard }
    );
  });

  // === Callback для присоединения оппонента ===
  bot.action(/^pvp_accept_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const opponent = ctx.from;

    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ This battle is no longer active.");
    if (battle.status !== "awaiting_accept") return ctx.reply("⚠️ Battle already started or finished.");

    await updateBattle(db, battleId, {
      opponentId: opponent.id,
      opponentUsername: opponent.username,
      status: "awaiting_payment_initiator",
    });

    await sendPaymentRequest(ctx, battleId, "initiator", battle.prizePool / 2);

    await ctx.reply(`💡 @${opponent.username}, waiting for organizer's payment.`);
  });
}
