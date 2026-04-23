// pvp/pvpWalletPayments.js - Wallet management for PvP
import { doc, getDoc, updateDoc, runTransaction } from "firebase/firestore";
import { getBattleById, updateBattle } from "./pvpFirebase.js";

/**
 * Инициализация wallet-платежей для PvP
 */
export function initPvpWalletPayments({ bot, db }) {
  
  /**
   * Списывает средства с кошелька пользователя
   */
  bot.deductFromWallet = async (userId, amount, battleId, role) => {
    const userIdStr = userId.toString();
    const userRef = doc(db, "users", userIdStr);

    try {
      const result = await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);

        if (!userSnap.exists()) {
          return { success: false, error: "User not found" };
        }

        const userData = userSnap.data();
        const currentWallet = userData.wallet || 0;

        if (currentWallet < amount) {
          return { success: false, error: "Insufficient funds" };
        }

        const newWallet = currentWallet - amount;

        transaction.update(userRef, {
          wallet: newWallet,
          lastWalletUpdate: Date.now()
        });

        // Логируем транзакцию
        const transactionId = `pvp_${battleId}_${role}_${Date.now()}`;
        const transactionRef = doc(db, "transactions", transactionId);
        
        transaction.set(transactionRef, {
          type: "pvp_entry",
          userId: userIdStr,
          battleId,
          role,
          amount: -amount,
          timestamp: Date.now(),
          status: "completed"
        });

        return { success: true, newWallet };
      });

      return result;
    } catch (err) {
      console.error("Deduct from wallet error:", err);
      return { success: false, error: "Transaction failed" };
    }
  };

  /**
   * Показывает опции пополнения кошелька
   */
  bot.showWalletTopupOptions = async (ctx) => {
    const userId = ctx.from.id.toString();
    
    const keyboard = {
      inline_keyboard: [
        [
          { text: "💎 100 ⭐", callback_data: `topup_100_${userId}` },
          { text: "💎 250 ⭐", callback_data: `topup_250_${userId}` }
        ],
        [
          { text: "💎 500 ⭐", callback_data: `topup_500_${userId}` },
          { text: "💎 1000 ⭐", callback_data: `topup_1000_${userId}` }
        ]
      ]
    };

    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);
    const currentWallet = (userSnap.exists() && userSnap.data().wallet) || 0;

    await bot.telegram.sendMessage(
      ctx.chat?.id || ctx.from.id,
      `💰 Your Wallet: ${currentWallet} ⭐\n\n` +
      `Choose amount to top up:`,
      { reply_markup: keyboard }
    );
  };

  // === Обработка кнопок пополнения ===
  bot.action(/^topup_(\d+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const amount = parseInt(ctx.match[1]);
    const userId = ctx.match[2];

    if (userId !== ctx.from.id.toString()) {
      return ctx.reply("⚠️ This invoice is not for you.");
    }

    try {
      const payload = `wallet_topup:${userId}:${amount}:${Date.now()}`;

      await ctx.replyWithInvoice({
        title: `Top Up Wallet`,
        description: `Add ${amount} ⭐ to your wallet`,
        payload,
        provider_token: "",
        currency: "XTR",
        prices: [{ label: `${amount} Stars`, amount }],
        start_parameter: "wallet_topup"
      });
    } catch (err) {
      console.error("Wallet topup invoice error:", err);
      return ctx.reply("⚠️ Error creating invoice. Please try again.");
    }
  });
}
