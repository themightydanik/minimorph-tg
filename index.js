import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);

// === /start handler ===
bot.start(async (ctx) => {
  console.log("🔥 /start received from:", ctx.from.id);
  try {
    const telegramId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || "there";
    const username = ctx.from.username || "";

    // Ссылки
    const startGameLink = `https://t.me/MinimorphBot?startapp=${telegramId}`;
    const howToPlayLink = 'https://minimorph.space/minimorph-telegram-game/';
    const communityLink = 'https://t.me/minimorph';

    // Кнопки
    const keyboard = {
      inline_keyboard: [
        [{ text: '🎰 Play Slot Machine', callback_data: 'play_slot' }],
        [{ text: '💳 Buy Slot Ticket (20 ⭐ = 3 spins)', callback_data: 'buy_ticket' }],
        [{ text: '🔄 Exchange Points for Free Spins', callback_data: 'exchange_points' }],
        [{ text: '💰 Withdraw Stars', callback_data: 'withdraw_stars' }],
        [{ text: '👥 Join Community', url: communityLink }],
        [{ text: '🎮 Minimorph Game', url: startGameLink }],
        [{ text: '📘 How to Play', url: howToPlayLink }],
      ]
    };

    await ctx.reply(`👾 Hey 👋, ${firstName}! Welcome to Minimorph game!`, { reply_markup: keyboard });
    console.log("✅ Reply sent successfully");
  } catch (err) {
    console.error("❌ Error in /start handler:", err);
    await ctx.reply("⚠️ Something went wrong, please try again later.");
  }
});

// === Ping route ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

// === Start Express server & launch bot ===
app.listen(port, async () => {
  console.log(`🚀 Express server listening on port ${port}`);
  try {
    await bot.launch();
    console.log("🤖 Bot launched with long polling");
  } catch (err) {
    console.error("❌ Failed to launch bot:", err);
  }
});
