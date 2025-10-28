// pvp/pvpHandlers.js
import { createBattle, getBattleById, updateBattle } from "./pvpFirebase.js";
import { sendPaymentRequest } from "./pvpPayments.js";

export default function initPvpHandlers({ bot, db }) {
  // Команда для старта батла
  bot.command("battle", async (ctx) => {
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
      `⚔️ @${user.username || user.first_name} — выбери призовой фонд для батла.`,
      { reply_markup: keyboard }
    );
  });

  // После выбора призового фонда
  bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const prizePool = parseInt(ctx.match[1]);
    const user = ctx.from;

    // Создаем батл в Firebase
    const battle = await createBattle(db, user, prizePool);

    // Отправляем сообщение с кнопкой для принятия батла другим игроком
    const acceptKeyboard = {
      inline_keyboard: [
        [{ text: "✅ Accept Battle", callback_data: `pvp_accept_${battle.id}` }],
      ],
    };

    await ctx.reply(
      `🎯 @${user.username || user.first_name} создал батл!\n\nПризовой фонд: ${prizePool} ⭐\n(по ${prizePool / 2} ⭐ с каждого)\n\nЖдём соперника...`,
      { reply_markup: acceptKeyboard }
    );

    // Отправляем запрос на оплату организатору
    await sendPaymentRequest(ctx, battle.id, "initiator", prizePool / 2);
  });

  // Принятие вызова оппонентом
  bot.action(/^pvp_accept_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const opponent = ctx.from;

    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Этот батл уже не активен.");
    if (battle.status !== "awaiting_accept" && battle.status !== "initiator_paid") {
      return ctx.reply("⚠️ Батл уже начат или завершён.");
    }

    // Обновляем оппонента
    await updateBattle(db, battleId, {
      opponentId: opponent.id,
      opponentUsername: opponent.username,
      status: battle.status === "initiator_paid" ? "awaiting_payment_opponent" : "awaiting_accept",
    });

    await ctx.reply(
      `💸 @${opponent.username} принял вызов!\nТеперь необходимо оплатить участие ${battle.prizePool / 2} ⭐`
    );

    if (battle.status === "initiator_paid") {
      // Если организатор уже оплатил, отправляем оплату оппоненту
      await sendPaymentRequest(ctx, battleId, "opponent", battle.prizePool / 2);
    }
  });
}
