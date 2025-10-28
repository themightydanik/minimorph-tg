// pvp/pvpPayments.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";

export default function initPvpPayments({ bot, db }) {
  // Сохраняем ссылку на Firestore внутри бота, чтобы не потерять
  bot.db = db;

  // === Когда пользователь подтверждает оплату ===
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  // === Когда оплата успешна ===
  bot.on("successful_payment", async (ctx) => {
    try {
      const payload = ctx.message.successful_payment.invoice_payload;
      const [type, battleId, role] = payload.split("_");

      const battle = await getBattleById(db, battleId);
      if (!battle) return;

      const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
      if (ctx.from.id !== expectedId) {
        return ctx.reply("⚠️ This invoice is not for you.");
      }

      // === Обновляем статус оплаты ===
      if (role === "initiator") await updateBattle(db, battleId, { status: "initiator_paid" });
      if (role === "opponent") await updateBattle(db, battleId, { status: "opponent_paid" });

      const updated = await getBattleById(db, battleId);

      // === Проверяем, оплатили ли оба ===
      if (
        (updated.status === "initiator_paid" && role === "opponent") ||
        (updated.status === "opponent_paid" && role === "initiator")
      ) {
        await updateBattle(db, battleId, { status: "paid_by_both" });
      }

      await ctx.reply("✅ Payment successful! You can return to the battle chat.");
    } catch (err) {
      console.error("❌ Payment handling error:", err);
      await ctx.reply("⚠️ Payment error. Please try again later.");
    }
  });
}

/**
 * === Создание инвойса в приватном чате ===
 */
export async function createInvoiceForUser(bot, db, userId, battleId, role) {
  try {
    const battle = await getBattleById(db, battleId);
    if (!battle) return;

    const amount = battle.prizePool / 2;

    await bot.telegram.sendInvoice(userId, {
      title: "PvP Battle Entry",
      description: `Entry fee (${role})`,
      payload: `pvp_${battleId}_${role}`,
      currency: "XTR",
      prices: [{ label: "Entry Fee", amount }],
    });
  } catch (err) {
    console.error("❌ Invoice creation error:", err);
  }
}
