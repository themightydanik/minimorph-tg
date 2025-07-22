import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

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
  const startGameLink = `https://t.me/MinimorphBot/start${referralParam}`;
  const howToPlayLink = 'https://minimorph-miniapp.netlify.app/how-to-play';
  const communityLink = 'https://t.me/minimorph_community'; // замени на свою ссылку

  await ctx.reply(
    `👾 Hey 👋, ${ctx.from.first_name}! Welcome to Minimorph game!`,
    Markup.inlineKeyboard([
      [Markup.button.url('🎮 Start Game', `https://t.me/MinimorphBot/start${referralParam}`)],
      [Markup.button.url('📘 How to Play', 'https://minimorph.space/telegram-game')],
      [Markup.button.url('👥 Join Community', 'https://t.me/minimorph')]
    ])
  );
});

bot.launch();
console.log('Bot is running...');
