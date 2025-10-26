import express from 'express';
import referralRoute from "./referral.js";
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);

// после создания bot и app...
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "293621311"; // твой admin id
const SLOT_ADMIN_SECRET = process.env.SLOT_ADMIN_SECRET || "SherbetLemon123@";

const slotRouter = initSlotModule({
  bot,
  db,
  ADMIN_ID: SLOT_ADMIN_ID,
  ADMIN_SECRET: SLOT_ADMIN_SECRET,
  PRICE_STARS: parseInt(process.env.SLOT_PRICE_STARS || "20", 10),
  TICKETS_PER_PURCHASE: parseInt(process.env.SLOT_TICKETS_PER_PURCHASE || "3", 10),
  JACKPOT_REWARD: parseInt(process.env.SLOT_JACKPOT_REWARD || "100", 10),
  PAIR_REWARD: parseInt(process.env.SLOT_PAIR_REWARD || "5", 10),
  NEWBIE_SPINS: parseInt(process.env.SLOT_NEWBIE_SPINS || "9", 10),
  NEWBIE_MULTIPLIER: parseFloat(process.env.SLOT_NEWBIE_MULTIPLIER || "1.3"),
});

app.use("/slot", slotRouter);

// Middleware
app.use(express.json());
app.use("/referral", referralRoute);

// === COMMANDS REQUIRED BY TELEGRAM ===
bot.command(["support", "paysupport"], async (ctx) => {
  await ctx.reply("💬 For support, please contact @Deviola_programmer.\nWe’ll help you resolve any issues as soon as possible.");
});

bot.command("terms", async (ctx) => {
  await ctx.reply(
    "📜 Terms of Use:\n\n" +
    "1. Playing the slot machine costs Telegram Stars.\n" +
    "2. Rewards are paid out in Telegram Stars automatically.\n" +
    "3. Gambling responsibly — play for fun.\n" +
    "4. For help, contact @Deviola_programmer."
  );
});

// Bot logic
bot.start(async (ctx) => {
  const ref = ctx.startPayload;
  const telegramId = ctx.from.id.toString();

  if (ref && ref !== telegramId) {
    console.log(`👥 Пользователь ${telegramId} пришёл по ссылке ${ref}`);
    try {
      const response = await fetch('https://minimorph-tg.onrender.com/referral', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
body: JSON.stringify({
  telegramId,
  invitedBy: ref,
  username: ctx.from.username,
  first_name: ctx.from.first_name
})

      });
      const result = await response.text();
      console.log("📨 Referral API response:", result);
    } catch (error) {
      console.error("❌ Failed to send referral data:", error);
    }
  }

  const startGameLink = `https://t.me/MinimorphBot?startapp=${telegramId}`;
  const howToPlayLink = 'https://minimorph.space/minimorph-telegram-game/';
  const communityLink = 'https://t.me/minimorph';

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

  await ctx.reply(
    `👾 Hey 👋, ${ctx.from.first_name}! Welcome to Minimorph game!`,
    { reply_markup: keyboard }
  );
});

// === CALLBACK HANDLERS ===
bot.action('play_slot', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🎰 To play, simply send the emoji 🎰 in this chat — Telegram will spin the slot for you!');
});

bot.action('buy_ticket', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('💳 Processing your ticket purchase...');
  try {
    await handleBuyTicket(ctx); // 👉 сразу запускает покупку
  } catch (err) {
    console.error(err);
    await ctx.reply('❌ Failed to initiate purchase. Try again later.');
  }
});

bot.action('exchange_points', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply('🎁 Play various games inside the Minimorph Mini-App and exchange points for free spins to play slots!');
});

bot.action('withdraw_stars', async (ctx) => {
  await ctx.answerCbQuery();
  const userId = ctx.from.id.toString();
  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();

  if (!userSnap.exists) {
    return ctx.reply("⚠️ You don’t have any winnings yet.");
  }

 const data = userSnap.data();
  const pending = data.pendingPayoutStars || 0;

  if (pending < 50) {
    return ctx.reply(`💡 Minimum withdrawal is 50 ⭐️. Your current balance: ${pending} ⭐️`);
  }

  try {
    // ⚙️ Тут делаем выплату через Telegram Stars API (позже вставим реальный вызов)
    // Пример:
    // await bot.telegram.sendStars(userId, balance);

    await userRef.update({ pendingPayoutStars: 0 });
    await ctx.reply(`✅ Your payout of ${pending} ⭐️ has been successfully queued. Your Stars balance will update within a few hours.`);
  } catch (error) {
    console.error("❌ Withdrawal error:", error);
    await ctx.reply("🚫 Error during withdrawal. Please try again later.");
  }
});

// Bot webhook endpoint
app.use(bot.webhookCallback("/telegram"));


// Ping route for uptime check
app.get("/", (req, res) => {
  res.send("✅ Bot is running");
});

// Prevent Render sleep
setInterval(() => {
  fetch(`https://minimorph-tg.onrender.com/`)
    .then(() => console.log("🔁 Self-ping to prevent Render sleep"))
    .catch((err) => console.error("❌ Self-ping failed:", err));
}, 5 * 60 * 1000);

// Start server and register webhook
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);

  try {
    const webhookUrl = `https://minimorph-tg.onrender.com/telegram`;
    await bot.telegram.setWebhook(webhookUrl);
    console.log("✅ Webhook set to:", webhookUrl);
  } catch (err) {
    console.error("❌ Failed to set webhook:", err);
  }
});
