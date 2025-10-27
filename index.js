import express from 'express';
import referralRoute from "./referral.js";
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);

// === Slot module setup ===
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "917309737";
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
app.use(express.json());
app.use("/referral", referralRoute);

// === Commands & Handlers ===
bot.command(["support", "paysupport"], async (ctx) => {
  try {
    await ctx.reply("💬 For support, please contact @Deviola_programmer.\nWe’ll help you resolve any issues as soon as possible.");
  } catch (err) {
    console.error("❌ /support command error:", err);
  }
});

bot.command("terms", async (ctx) => {
  try {
    await ctx.reply(
      "📜 Terms of Use:\n\n" +
      "1. Playing the slot machine costs Telegram Stars.\n" +
      "2. Rewards are paid out in Telegram Stars automatically.\n" +
      "3. Gambling responsibly — play for fun.\n" +
      "4. For help, contact @Deviola_programmer."
    );
  } catch (err) {
    console.error("❌ /terms command error:", err);
  }
});

// === /start handler ===
bot.start(async (ctx) => {
  console.log("🔥 /start received from:", ctx.from.id); // <-- для отладки
  try {
    const telegramId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || "there";
    const username = ctx.from.username || "";
    const ref = ctx.startPayload || null;

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

    await ctx.reply(`👾 Hey 👋, ${firstName}! Welcome to Minimorph game!`, { reply_markup: keyboard });

    // === Async referral processing ===
    if (ref && ref !== telegramId) {
      setImmediate(async () => {
        console.log(`👥 User ${telegramId} came via referral ${ref}`);
        try {
          // Публичный IP твоего VPS и порт приложения
          const REFERRAL_URL = `http://103.13.208.11:${port}/referral`;
          const response = await fetch(REFERRAL_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ telegramId, invitedBy: ref, username, first_name: firstName })
          });
          const result = await response.text();
          console.log("📨 Referral API response:", result);
        } catch (err) {
          console.error("❌ Failed to send referral data:", err);
        }
      });
    }
  } catch (err) {
    console.error("❌ Error in /start handler:", err);
  }
});

// === Callback handlers ===
bot.action('play_slot', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('🎰 To play, simply send the emoji 🎰 in this chat — Telegram will spin the slot for you!');
  } catch (err) {
    console.error("❌ play_slot action error:", err);
  }
});

bot.action('buy_ticket', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('💳 Processing your ticket purchase...');
    await handleBuyTicket(ctx);
  } catch (err) {
    console.error("❌ buy_ticket action error:", err);
    await ctx.reply('❌ Failed to initiate purchase. Try again later.');
  }
});

bot.action('exchange_points', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('🎁 Play various games inside the Minimorph Mini-App and exchange points for free spins to play slots!');
  } catch (err) {
    console.error("❌ exchange_points action error:", err);
  }
});

bot.action('withdraw_stars', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userId = ctx.from.id.toString();
    const userRef = db.collection("users").doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) return await ctx.reply("⚠️ You don’t have any winnings yet.");

    const data = userSnap.data();
    const pending = data.pendingPayoutStars || 0;

    if (pending < 50) return await ctx.reply(`💡 Minimum withdrawal is 50 ⭐️. Your current balance: ${pending} ⭐️`);

    await userRef.update({ pendingPayoutStars: 0 });
    await ctx.reply(`✅ Your payout of ${pending} ⭐️ has been successfully queued. Your Stars balance will update within a few hours.`);
  } catch (err) {
    console.error("❌ withdraw_stars action error:", err);
    await ctx.reply("🚫 Error during withdrawal. Please try again later.");
  }
});

// === Ping route ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

// === Start Express server & launch bot ===
const server = app.listen(port, async () => {
  console.log(`🚀 Express server listening on port ${port}`);

  try {
    await bot.telegram.deleteWebhook();
    await bot.launch({
      polling: {
        timeout: 30,
        limit: 100,
        dropPendingUpdates: true
      }
    });
    console.log("🤖 Bot launched with long polling");
  } catch (err) {
    console.error("❌ Failed to launch bot:", err);
  }
});

// === Отлов ошибки порта ===
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`⚠️ Port ${port} is already in use. Maybe a previous instance is running.`);
  } else {
    console.error(err);
  }
});
