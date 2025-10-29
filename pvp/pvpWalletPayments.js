// pvp/pvpWalletPayments.js
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { updateBattle, getBattleById } from "./pvpFirebase.js";

/**
 * 💳 Инициализация логики кошелька и платежей (Wallet + PvP)
 */
export function initPvpWalletPayments({ bot, db }) {
  const walletAmounts = [1, 125, 250]; // пакеты Stars

  // --- 🧾 Показать пользователю варианты пополнения ---
  async function showWalletTopupOptions(ctx) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return console.error("No chat id for wallet topup");

    const keyboard = {
      inline_keyboard: walletAmounts.map(amount => [
        {
          text: `💳 Add ${amount} Star${amount > 1 ? "s" : ""}`,
          callback_data: `wallet_add_${amount}`,
        },
      ]),
    };

    try {
      await bot.telegram.sendMessage(
        chatId,
        "💡 Choose how many Stars to add to your Wallet:",
        { reply_markup: keyboard }
      );
    } catch (err) {
      console.error("Error showing wallet topup options:", err);
    }
  }

  bot.showWalletTopupOptions = showWalletTopupOptions;

  // --- 💰 Обработка выбора пакета Stars ---
  bot.action(/^wallet_add_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const amount = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id.toString();

    const payload = `wallet_topup:${telegramId}:${amount}:${Date.now()}`;
    const title = `${amount} Stars for Wallet`;
    const description = `Top up your internal Wallet with ${amount} Stars.`;
    const startParameter = `wallet_topup_${Date.now()}`;

    const prices = [{ label: `${amount} Stars`, amount }];

    try {
      await ctx.replyWithInvoice({
        title,
        description,
        payload,
        provider_token: "", // ⭐ Stars → оставляем пустым
        currency: "XTR",
        prices,
        start_parameter: startParameter,
      });
    } catch (err) {
      console.error("Wallet invoice error:", err);
      await ctx.reply("⚠️ Error creating invoice. Contact admin.");
    }
  });

  // --- ✅ Разрешение на оплату Stars ---
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("Pre-checkout error:", err);
    }
  });

  // --- 💸 Обработка успешных оплат (Stars + PvP) ---
  bot.on("successful_payment", async (ctx) => {
    try {
      const payment = ctx.message.successful_payment;
      const payload = payment.invoice_payload;

      if (!payload) return;
      console.log("💰 Successful payment payload:", payload);

      // --- 1️⃣ Пополнение Wallet ---
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
          `✅ Payment successful!\n💫 Added ${amount} ⭐ to your Wallet.\n💰 Current balance: ${newWallet} ⭐`
        );
        return;
      }

      // --- 2️⃣ PvP Battle оплата ---
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
 * 🧾 Создание инвойса для PvP
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
      provider_token: "", // ⭐ Stars
    });
  } catch (err) {
    console.error("❌ Invoice creation error:", err);
  }
}
