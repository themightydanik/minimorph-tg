// pvp/pvpWalletPayments.js (CLEANED - только UI, БЕЗ обработчиков платежей)
import { doc, runTransaction, collection } from "firebase/firestore";

/**
 * 💳 Инициализация UI для кошелька (БЕЗ обработчиков платежей - они в paymentsHandler.js)
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

  // --- 💰 Обработка выбора пакета Stars (создание инвойса) ---
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
