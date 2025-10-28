import { updateBattle, getBattleById } from "./pvpFirebase.js";

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
    if (ctx.from.id !== expectedId) return ctx.reply("⚠️ This invoice is not for you.");

    if (role === "initiator") {
      await updateBattle(db, battleId, { status: "initiator_paid" });

      if (battle.opponentId) {
        await bot.telegram.sendMessage(
          battle.opponentId,
          `💸 Organizer has paid! Now it's your turn to pay (${battle.prizePool / 2} ⭐).`
        );
        await createInvoiceForUser(bot, battle.opponentId, battleId, "opponent", battle.prizePool / 2);
      }
    } else if (role === "opponent") {
      await updateBattle(db, battleId, { status: "opponent_paid" });
    }

    // Оба оплатили
    const updated = await getBattleById(db, battleId);
    if (
      (updated.status === "initiator_paid" && role === "opponent") ||
      (updated.status === "opponent_paid" && role === "initiator")
    ) {
      await updateBattle(db, battleId, { status: "paid_by_both" });
    }

    await ctx.reply("✅ Payment successful! You can return to the battle chat.");
  });
}

/**
 * Создание инвойса для конкретного пользователя в приватном чате через ctx
 */
export async function createInvoiceForUser(bot, userId, battleId, role, amount) {
  await bot.telegram.sendMessage(userId, `💳 Please pay your entry fee (${amount} ⭐)`);
  await bot.telegram.sendInvoice(userId, {
    title: `PvP Battle Entry`,
    description: `Entry fee (${role})`,
    payload: `pvp_${battleId}_${role}`,
    currency: "XTR",
    prices: [{ label: "Entry Fee", amount }],
  });
}
