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

    // Проверяем, что именно тот игрок оплатил
    const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
    if (ctx.from.id !== expectedId) {
      return ctx.reply("⚠️ This invoice is not for you.");
    }

    if (role === "initiator") {
      await updateBattle(db, battleId, { status: "initiator_paid" });

      const updated = await getBattleById(db, battleId);
      if (updated.opponentId) {
        await sendPaymentRequest(ctx, battleId, "opponent", updated.prizePool / 2, updated.opponentId);
        await ctx.telegram.sendMessage(
          updated.opponentId,
          `💸 The organizer has paid! Now it's your turn to pay for your participation. (${updated.prizePool / 2} ⭐).`
        );
      }
    } else if (role === "opponent") {
      await updateBattle(db, battleId, { status: "opponent_paid" });
    }

    // Проверяем, оба ли заплатили
    const checkBattle = await getBattleById(db, battleId);
    if (
      (checkBattle.status === "initiator_paid" && role === "opponent") ||
      (checkBattle.status === "opponent_paid" && role === "initiator")
    ) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
      await startBattle(ctx.bot, db, battleId);
    }
  });
}

/**
 * Отправка платежа конкретному пользователю
 */
export async function sendPaymentRequest(ctx, battleId, role, amount, userId) {
  // Проверяем, что это правильный пользователь
  if (ctx.from.id !== userId) {
    return ctx.reply("⚠️ You are not authorized to pay this invoice.");
  }

  await ctx.replyWithInvoice({
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount }],
  });
}
