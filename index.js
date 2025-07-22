import express from 'express';
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  const userId = ctx.from.id.toString();

  // Если есть реферальный ID и он не совпадает с пользователем
  if (ref && ref !== userId) {
    console.log(`Пользователь ${userId} пришёл по ссылке ${ref}`);
    // Здесь можно сохранить в базу
  }

  const referralParam = `?startapp=${userId}`;
  const startGameLink = `https://minimorph-miniapp.netlify.app?ref=${userId}`;
  const howToPlayLink = 'https://minimorph.space/how-to-play';
  const communityLink = 'https://t.me/minimorph_community'; // замени на свою ссылку

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: '🎮 Start Game',
          web_app: { url: startGameLink }
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

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
