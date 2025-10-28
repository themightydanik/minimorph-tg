// pvp/pvpPayments.js
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

    // ✅ Проверка, что именно тот игрок оплатил
    const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
    if (ctx.from.id !== expectedId) {
      return ctx.reply("⚠️ This invoice is not for you.");
    }

    if (role === "initiator") {
      await updateBattle(db, battleId, { status: "initiator_paid" });

      const updated = await getBattleById(db, battleId);
      if (updated.opponentId) {
        // Отправляем инвойс оппоненту в приватный чат
        await bot.telegram.sendMessage(
          updated.opponentId,
          `💸 Organizer has paid! Now it's your turn to pay (${updated.prizePool / 2} ⭐).`
        );
        await sendPaymentRequest(bot.telegram, updated.opponentId, battleId, "opponent", updated.prizePool / 2);
      }
    } else if (role === "opponent") {
      await updateBattle(db, battleId, { status: "opponent_paid" });
    }

    // ✅ Проверяем, оба ли оплатили
    const checkBattle = await getBattleById(db, battleId);
    if (
      (checkBattle.status === "initiator_paid" && role === "opponent") ||
      (checkBattle.status === "opponent_paid" && role === "initiator")
    ) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(bot, db, battleId);
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
