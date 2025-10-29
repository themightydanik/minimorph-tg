// pvp/pvpWalletPayments.js (IMPROVED VERSION)
import { doc, getDoc, setDoc, updateDoc, runTransaction, collection, addDoc } from "firebase/firestore";
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

    // 🔒 Уникальный payload с timestamp для предотвращения дублей
    const timestamp = Date.now();
    const payload = `wallet_topup:${telegramId}:${amount}:${timestamp}`;
    const title = `${amount} Stars for Wallet`;
    const description = `Top up your internal Wallet with ${amount} Stars.`;
    const startParameter = `wallet_topup_${timestamp}`;

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
        const [, userId, amountStr, timestamp] = payload.split(":");
        const amount = parseInt(amountStr, 10);
        
        // 🔒 Защита от дублирования: проверяем уникальность транзакции
        const transactionId = `topup_${userId}_${timestamp}`;
        const transactionRef = doc(db, "transactions", transactionId);
        const transactionSnap = await getDoc(transactionRef);
        
        if (transactionSnap.exists()) {
          console.warn(`⚠️ Duplicate transaction detected: ${transactionId}`);
          return ctx.reply("⚠️ This payment was already processed.");
        }

        const userRef = doc(db, "users", userId);

        // 🔒 Используем транзакцию для атомарного обновления
        const newWallet = await runTransaction(db, async (transaction) => {
          const userSnap = await transaction.get(userRef);
          
          let currentWallet = 0;
          if (!userSnap.exists()) {
            // Создаём нового пользователя
            transaction.set(userRef, {
              username: ctx.from.username || `User-${userId}`,
              wallet: amount,
              createdAt: Date.now(),
            });
            currentWallet = amount;
          } else {
            currentWallet = userSnap.data().wallet || 0;
            transaction.update(userRef, { 
              wallet: currentWallet + amount,
              lastWalletUpdate: Date.now()
            });
            currentWallet += amount;
          }

          // 📝 Логируем транзакцию
          transaction.set(transactionRef, {
            type: "topup",
            userId,
            amount,
            timestamp: Date.now(),
            telegramChargeId: payment.telegram_payment_charge_id || null,
            providerChargeId: payment.provider_payment_charge_id || null,
            status: "completed"
          });

          return currentWallet;
        });

        console.log(`✅ Wallet updated for ${userId}: +${amount} ⭐, total = ${newWallet}`);

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
        if (ctx.from.id.toString() !== expectedId.toString()) {
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

  /**
   * 💳 Атомарное списание с wallet для PvP (с защитой от race conditions)
   */
  bot.deductFromWallet = async function(userId, amount, battleId, role) {
    const userRef = doc(db, "users", userId.toString());
    
    try {
      const result = await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        
        if (!userSnap.exists()) {
          throw new Error("User not found");
        }

        const currentWallet = userSnap.data().wallet || 0;
        
        if (currentWallet < amount) {
          throw new Error("Insufficient funds");
        }

        const newWallet = currentWallet - amount;
        transaction.update(userRef, { 
          wallet: newWallet,
          lastWalletUpdate: Date.now()
        });

        // 📝 Логируем списание
        const transactionRef = doc(collection(db, "transactions"));
        transaction.set(transactionRef, {
          type: "pvp_deduct",
          userId: userId.toString(),
          amount: -amount,
          battleId,
          role,
          timestamp: Date.now(),
          status: "completed"
        });

        return newWallet;
      });

      return { success: true, newWallet: result };
    } catch (err) {
      console.error(`❌ Wallet deduction failed for ${userId}:`, err);
      return { success: false, error: err.message };
    }
  };
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
