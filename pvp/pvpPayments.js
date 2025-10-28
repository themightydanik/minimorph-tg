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

    if (role === "initiator") {
      await updateBattle(db, battleId, { status: "initiator_paid" });

      const updated = await getBattleById(db, battleId);
      if (updated.opponentId) {
        await sendPaymentRequest(ctx, battleId, "opponent", updated.prizePool / 2);
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

export async function sendPaymentRequest(ctx, battleId, role, amount) {
  await ctx.replyWithInvoice({
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount }],
  });
}
