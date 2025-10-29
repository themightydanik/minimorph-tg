// pvp/pvpPayments.js
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { updateBattle, getBattleById } from "./pvpFirebase.js";

export default function initPvpPayments({ bot, db }) {
  bot.db = db;

  // ✅ Telegram PreCheckout
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("PreCheckout error:", err);
    }
  });

  // ✅ Универсальный обработчик успешной оплаты
  bot.on("successful_payment", async (ctx) => {
    try {
      const payment = ctx.message.successful_payment;
      const payload = payment.invoice_payload;

      if (!payload) return;

      console.log("💰 Successful payment payload:", payload);

      // --- 🟣 1️⃣ Пополнение Wallet ---
      if (payload.startsWith("wallet_topup:")) {
        const [, userId, amountStr] = payload.split(":");
        const amount = parseInt(amountStr, 10);

        const userRef = doc(db, "users", userId);
        const userSnap = await getDoc(userRef);

        let newWallet;
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            username: ctx.from.username || `User-${userId}`,
            wallet: amount,
            createdAt: Date.now(),
          });
          newWallet = amount;
          console.log(`🆕 Wallet created for ${userId}: ${newWallet} ⭐`);
        } else {
          const currentWallet = userSnap.data().wallet || 0;
          newWallet = currentWallet + amount;
          await updateDoc(userRef, { wallet: newWallet });
          console.log(`✅ Wallet updated for ${userId}: +${amount} ⭐, total = ${newWallet}`);
        }

        await bot.telegram.sendMessage(
          userId,
          `✅ Payment successful! ${amount} ⭐ added to your Wallet.\nCurrent balance: ${newWallet} ⭐`
        );
        return; // важно: выходим, чтобы не обрабатывало как PvP
      }

      // --- 🔵 2️⃣ PvP Battle оплата ---
      if (payload.startsWith("pvp_")) {
        const [type, battleId, role] = payload.split("_");

        const battle = await getBattleById(db, battleId);
        if (!battle) return;

        const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
        if (ctx.from.id !== expectedId) {
          return ctx.reply("⚠️ This invoice is not for you.");
        }

        if (role === "initiator") await updateBattle(db, battleId, { initiatorPaid: true });
        if (role === "opponent") await updateBattle(db, battleId, { opponentPaid: true });

        const updated = await getBattleById(db, battleId);
        if (updated.initiatorPaid && updated.opponentPaid) {
          await updateBattle(db, battleId, { status: "paid_by_both" });
        }

        await ctx.reply("✅ Payment successful! You can return to the battle chat.");
        return;
      }

      console.warn("⚠️ Unknown payment type:", payload);

    } catch (err) {
      console.error("❌ Payment handling error:", err);
      try {
        await ctx.reply("⚠️ Payment error. Please contact admin.");
      } catch {}
    }
  });
}

/**
 * Создание инвойса для пользователя
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
