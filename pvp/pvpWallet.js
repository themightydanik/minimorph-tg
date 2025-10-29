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

  // 💡 Сохраняем функцию на объект бота, чтобы можно было вызывать из index.js
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
   * Обязательно нужно, иначе Telegram не разрешит оплату.
   */
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("Pre-checkout error:", err);
    }
  });

  // 💡 Обработка успешной оплаты теперь централизована в pvpPayments.js
}
