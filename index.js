import express from 'express';
import referralRoute from "./referral.js";
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();

const app = express();

app.use(express.json());
app.use("/referral", referralRoute);
const port = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  const telegramId = ctx.from.id.toString();

  // Если есть реферальный ID и он не совпадает с пользователем
  if (ref && ref !== telegramId) {
    console.log(`Пользователь ${telegramId} пришёл по ссылке ${ref}`);
    // Здесь можно сохранить в базу
    try {
    const response = await fetch('https://minimorph-tg.onrender.com/referral', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegramId,
        invitedBy: ref
      })
    });

    const result = await response.text();
    console.log("Referral API response:", result);
  } catch (error) {
    console.error("Failed to send referral data:", error);
  }
}

  const referralParam = `?startapp=${telegramId}`;
  const startGameLink = `https://t.me/MinimorphBot?startapp=${telegramId}`;
  const howToPlayLink = 'https://minimorph.space/minimorph-telegram-game/';
  const communityLink = 'https://t.me/minimorph';

  const keyboard = {
    inline_keyboard: [
      [
      {
        text: '🎮 Start Game',
        url: startGameLink
      }
      ],
      [
        { text: '📘 How to Play', url: howToPlayLink }
      ],
      [
        { text: '👥 Join Community', url: communityLink }
      ]
    ]
  };

    await ctx.reply(
    `👾 Hey 👋, ${ctx.from.first_name}! Welcome to Minimorph game!`,
    { reply_markup: keyboard }
  );
  
});

// Оборачиваем запуск бота в асинхронную функцию
(async () => {
  await bot.telegram.deleteWebhook();
  await bot.launch();
})();

// Простой HTTP-сервер для Render
app.get('/', (req, res) => {
  res.send('Bot is running');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});

setInterval(() => {
  fetch(`https://minimorph-tg.onrender.com/`).then(() => {
    console.log("🔁 Self-ping to prevent Render sleep");
  }).catch((err) => {
    console.error("❌ Self-ping failed:", err);
  });
}, 5 * 60 * 1000); // каждые 5 минут


process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
