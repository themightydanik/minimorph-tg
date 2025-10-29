// pvp/pvpWallet.js
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

export function initPvpWalletLogic({ bot, db }) {
  const walletAmounts = [1, 125, 250]; // доступные пакеты Stars

  /**
   * 💳 Показывает пользователю варианты пополнения Wallet.
   * ctx может быть обычным контекстом Telegraf или объектом { chat: { id } } для приватного сообщения.
   */
  async function showWalletTopupOptions(ctx) {
    const chatId = ctx.chat?.id || ctx.from?.id;
    if (!chatId) return console.error("No chat id for wallet topup");

    const keyboard = {
      inline_keyboard: walletAmounts.map(amount => [
        {
          text: `💳 Add ${amount} Star${amount > 1 ? "s" : ""}`,
          callback_data: `wallet_add_${amount}`
        }
      ])
    };

    await bot.telegram.sendMessage(
      chatId,
      "💡 Choose how many Stars to add to your Wallet:",
      { reply_markup: keyboard }
    );
  }

  // Сохраняем функцию на объект бота, чтобы вызывать из index.js
  bot.showWalletTopupOptions = showWalletTopupOptions;

  /**
   * 🧾 Обработка выбора пакета Stars для пополнения Wallet.
   */
  bot.action(/^wallet_add_(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery();

    const amount = parseInt(ctx.match[1], 10);
    const telegramId = ctx.from.id.toString();
    const payload = `wallet_topup:${telegramId}:${amount}:${Date.now()}`;
    const title = `${amount} Stars for Wallet`;
    const description = `Top up your internal Wallet with ${amount} Stars.`;
    const startParameter = `wallet_topup_${Date.now()}`;

    // Telegram Stars — валюта XTR
    const prices = [{ label: `${amount} Stars`, amount }];

    try {
      await ctx.replyWithInvoice({
        title,
        description,
        payload,
        provider_token: "", // TODO: вставить токен провайдера Stars
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
   * ✅ Подтверждение оплаты Stars (pre-checkout)
   */
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("Pre-checkout error:", err);
    }
  });

  /**
   * 💰 После успешной оплаты Stars — зачисляем эквивалентную сумму во внутренний Wallet пользователя (в Firestore)
   */
  bot.on("successful_payment", async (ctx) => {
    try {
      const payment = ctx.message.successful_payment;
      const payload = payment.invoice_payload; // wallet_topup:<telegramId>:<amount>:timestamp
      if (!payload?.startsWith("wallet_topup:")) return;

      const [, userId, amountStr] = payload.split(":");
      const amount = parseInt(amountStr, 10);

      const userRef = doc(db, "users", userId);
      const userSnap = await getDoc(userRef);

      // если пользователь впервые — создаём документ
      if (!userSnap.exists()) {
        await setDoc(userRef, {
          username: ctx.from.username || `User-${userId}`,
          wallet: amount,
          createdAt: Date.now(),
        });
      } else {
        const currentWallet = userSnap.data().wallet || 0;
        await updateDoc(userRef, { wallet: currentWallet + amount });
      }

      await bot.telegram.sendMessage(
        userId,
        `✅ Payment successful! ${amount} ⭐ added to your Wallet.\nCurrent balance: ${userSnap.exists() ? (userSnap.data().wallet || 0) + amount : amount} ⭐`
      );

    } catch (err) {
      console.error("Wallet update error:", err);
      await ctx.reply("⚠️ Error updating Wallet. Contact admin.");
    }
  });
}
