// pvp/pvpPayments.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";
import { startBattle } from "./pvpGameLogic.js";

export default function initPvpPayments({ bot, db }) {
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on("successful_payment", async (ctx) => {
    const payload = ctx.message.successful_payment.invoice_payload;
    const [type, battleId, role] = payload.split("_"); // "pvp_<id>_opponent" / "pvp_<id>_initiator"

    const battle = await getBattleById(db, battleId);
    if (!battle) return;

    if (role === "opponent") {
      await updateBattle(db, battleId, { status: "awaiting_payment_initiator" });
      await ctx.telegram.sendMessage(
        battle.initiatorId,
        `⚡️ @${ctx.from.username} has paid for participation!\nNow it's your turn to pay ${battle.prizePool / 2} ⭐`
      );
      await sendPaymentRequest(ctx, battleId, "initiator", battle.prizePool / 2);
    } else if (role === "initiator") {
      await updateBattle(db, battleId, { status: "ready" });
      await startBattle(bot, db, battleId);
    }
  });
}

export async function sendPaymentRequest(ctx, battleId, role, amount) {
  await ctx.replyWithInvoice({
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount: amount * 1000 }],
  });
}
