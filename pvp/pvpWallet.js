// pvp/pvpWallet.js
import { doc, getDoc, updateDoc } from "firebase/firestore";

export function initPvpWalletLogic({ bot, db }) {
  const walletAmounts = [1, 125, 250]; // доступные пакеты Stars

  /**
   * Показывает пользователю варианты пополнения Wallet
   */
  async function showWalletTopupOptions(ctx) {
    const keyboard = {
      inline_keyboard: walletAmounts.map(amount => [
        { text: `💳 Add ${amount} Star${amount > 1 ? "s" : ""}`, callback_data: `wallet_add_${amount}` }
      ])
    };
    await ctx.reply("💡 Choose how many Stars to add to your Wallet:", { reply_markup: keyboard });
  }

  // Сохраняем функцию на объект бота, чтобы вызывать из index.js
  bot.showWalletTopupOptions = showWalletTopupOptions;

  /**
   * Обработка нажатия кнопки Top Up Wallet
   */
  bot.action(/^wallet_add_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const amount = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id.toString();
    const payload = `wallet_topup:${telegramId}:${amount}:${Date.now()}`;
    const title = `${amount} Stars for Wallet`;
    const description = `Top up your internal Wallet with ${amount} Stars.`;
    const startParameter = `wallet_topup_${Date.now()}`;
    const prices = [{ label: `${amount} Stars`, amount }]; // для Stars — просто число

    try {
      await ctx.replyWithInvoice({
        title,
        description,
        payload,
        provider_token: "", // Stars payment
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
   * Pre-checkout: подтверждение платежа Stars
   */
  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  /**
   * После успешной оплаты Stars — зачисляем в Wallet
   */
  bot.on("successful_payment", async (ctx) => {
    try {
      const payment = ctx.message.successful_payment;
      const payload = payment.invoice_payload; // wallet_topup:<telegramId>:<amount>:timestamp
      const parts = payload.split(":");
      if (parts[0] !== "wallet_topup") return;

      const userId = parts[1];
      const amount = parseInt(parts[2], 10);

      const userRef = doc(db, "users", userId);
      const userSnap = await getDoc(userRef);
      let currentWallet = 0;
      if (userSnap.exists()) currentWallet = userSnap.data().wallet || 0;

      await updateDoc(userRef, { wallet: currentWallet + amount });

      await ctx.reply(
        `✅ Payment successful! ${amount} Stars added to your Wallet. Current balance: ${currentWallet + amount} ⭐`
      );
    } catch (err) {
      console.error("Wallet update error:", err);
      await ctx.reply("⚠️ Error updating Wallet. Contact admin.");
    }
  });
}
