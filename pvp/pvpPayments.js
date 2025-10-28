// pvp/pvpPayments.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";
import { startBattle } from "./pvpGameLogic.js";

export default function initPvpPayments({ bot, db }) {
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("successful_payment", async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [type, battleId, role] = payload.split("_"); // "pvp_<id>_initiator" или "pvp_<id>_opponent"

    const battle = await getBattleById(db, battleId);
    if (!battle) return;

    if (role === "initiator") {
      // Организатор оплатил
      await updateBattle(db, battleId, { status: "initiator_paid" });

      if (battle.opponentId) {
        // Отправляем запрос на оплату оппоненту
        const opponentCtx = { from: { id: battle.opponentId, username: battle.opponentUsername }, replyWithInvoice: ctx.replyWithInvoice.bind(ctx) };
        await sendPaymentRequest(opponentCtx, battleId, "opponent", battle.prizePool / 2);
      }
    } else if (role === "opponent") {
      // Оппонент оплатил → старт батла
      await updateBattle(db, battleId, { status: "ready" });
      await startBattle(bot, db, battleId);
    }
  });
}

// Отправка запроса на оплату
export async function sendPaymentRequest(ctx, battleId, role, amount) {
  await ctx.replyWithInvoice({
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount: amount * 1000 }],
  });
}
