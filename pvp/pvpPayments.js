import { updateBattle, getBattleById } from "./pvpFirebase.js";
import { startBattle } from "./pvpGameLogic.js";

export default function initPvpPayments({ bot, db }) {
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("successful_payment", async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [type, battleId, role] = payload.split("_");

    const battle = await getBattleById(db, battleId);
    if (!battle) return;

    const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
    if (ctx.from.id !== expectedId) {
      return ctx.reply("⚠️ This invoice is not for you.");
    }

    // Обновляем флаги оплаты и статус
    const updateData = {};
    if (role === "initiator") {
      updateData.initiatorPaid = true;
      updateData.status = "initiator_paid";
    } else if (role === "opponent") {
      updateData.opponentPaid = true;
      updateData.status = "opponent_paid";
    }

    await updateBattle(db, battleId, updateData);
    const updatedBattle = await getBattleById(db, battleId);

    // Если оба оплатили — запускаем игру
    if (updatedBattle.initiatorPaid && updatedBattle.opponentPaid) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(bot, db, battleId);
    } else if (role === "initiator" && updatedBattle.opponentId) {
      // отправляем инвойс оппоненту
      await bot.telegram.sendMessage(
        updatedBattle.opponentId,
        `💸 Organizer has paid! Now it's your turn to pay (${updatedBattle.prizePool / 2} ⭐).`
      );
      await sendPaymentRequest(bot.telegram, updatedBattle.opponentId, battleId, "opponent", updatedBattle.prizePool / 2);
    }

    await ctx.reply("✅ Payment successful! You can return to the battle chat.");
  });
}

/**
 * Отправка платежа конкретному пользователю в приватный чат
 */
export async function sendPaymentRequest(telegram, userId, battleId, role, amount) {
  await telegram.sendInvoice(userId, {
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount }],
  });
}
