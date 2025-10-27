import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import fetch from "node-fetch"; // для POST к referral.js

dotenv.config();

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

// === Commands ===
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

// === /start handler with referral integration ===
bot.start(async (ctx) => {
  console.log("🔥 /start received from:", ctx.from.id);
  try {
    const telegramId = ctx.from.id.toString();
    const firstName = ctx.from.first_name || "there";

    // --- Referral processing ---
    const payload = ctx.startPayload || ""; // Telegram Mini-App payload
    let invitedBy = null;
    if (payload.startsWith("ref_")) {
      invitedBy = payload.slice(4); // получаем ID реферера
    }

    if (invitedBy && invitedBy !== telegramId) {
      try {
        await fetch(`${process.env.BASE_URL}/referral/referral`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            telegramId,
            invitedBy,
            username: ctx.from.username,
            first_name: firstName
          })
        });
      } catch (err) {
        console.error("❌ Referral POST error:", err);
      }
    }

    // --- Buttons / keyboard ---
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

  } catch (err) {
    console.error("❌ Error in /start handler:", err);
  }
});

// === Slot button handlers ===
bot.action('play_slot', async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const keyboard = {
      inline_keyboard: [
        [
          {
            text: '🎰 Copy & Play',
            url: 'tg://msg?text=🎰'
          }
        ]
      ]
    };

    await ctx.reply(
      '🎰 To play the slot:\n' +
      '1️⃣ Send the 🎰 emoji in this chat manually, OR\n' +
      '2️⃣ Press the button below to forward the emoji to Minimorph game',
      { reply_markup: keyboard }
    );

  } catch (err) {
    console.error("❌ play_slot action error:", err);
  }
});




bot.action('buy_ticket', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.reply('💳 Opening payment window...');
    await bot.telegram.sendMessage(ctx.chat.id, "/buyticket");
    await bot.handleUpdate({
      update_id: Date.now(),
      message: {
        chat: ctx.chat,
        from: ctx.from,
        text: "/buyticket",
        entities: [{ offset: 0, length: 10, type: "bot_command" }],
      },
    });
  } catch (err) {
    console.error("❌ buy_ticket action error:", err);
    await ctx.reply('❌ Failed to open payment window. Try again later.');
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
    const userRef = doc(db, "users", userId);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return await ctx.reply("⚠️ You don’t have any winnings yet.");

    const data = userSnap.data();
    const earned = data.slotEarnedStars || 0;

    if (earned < 100) return await ctx.reply(`💡 Minimum withdrawal is 100 ⭐️. Your current balance: ${earned} ⭐️`);

    await updateDoc(userRef, {
      pendingPayoutStars: (data.pendingPayoutStars || 0) + earned,
      slotEarnedStars: 0,
    });

    await ctx.reply(`✅ Your payout request of ${earned} ⭐️ has been queued. Admin will send Stars manually.`);

    try {
      await bot.telegram.sendMessage(
        SLOT_ADMIN_ID,
        `💰 User @${ctx.from.username || ctx.from.id} requested withdrawal of ${earned} ⭐️.`
      );
    } catch (notifyErr) {
      console.error("Failed to notify admin:", notifyErr);
    }

  } catch (err) {
    console.error("❌ withdraw_stars action error:", err);
    await ctx.reply("🚫 Error during withdrawal. Please try again later.");
  }
});

// === Ping route ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

// === Start server and launch bot ===
app.listen(port, async () => {
  console.log(`🚀 Express server listening on port ${port}`);
  try {
    await bot.launch();
    console.log("🤖 Bot launched with long polling");
  } catch (err) {
    console.error("❌ Failed to launch bot:", err);
  }
});
