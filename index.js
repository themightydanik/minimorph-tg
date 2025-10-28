import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { createBattle, getBattleById, updateBattle } from "./pvp/pvpFirebase.js";
import { initPvpWalletLogic } from "./pvp/pvpWallet.js";
import { startBattle } from "./pvp/pvpGameLogic.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.db = db;

// === Constants ===
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "917309737";
const SLOT_ADMIN_SECRET = process.env.SLOT_ADMIN_SECRET || "SherbetLemon123@";

// === Slot Module ===
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

// === PvP Wallet Logic ===
initPvpWalletLogic({ bot, db });

// === Global Commands ===
bot.command(["support", "paysupport"], async (ctx) => {
  await ctx.reply("💬 For support, please contact @Deviola_programmer.");
});

bot.command("terms", async (ctx) => {
  await ctx.reply(
    "📜 Terms of Use:\n" +
    "1. Slot and Battle games may require Stars or internal wallet payments.\n" +
    "2. Rewards are manually processed or instant in wallet.\n" +
    "3. Gamble responsibly.\n" +
    "4. Contact @Deviola_programmer for help."
  );
});

// === /start handler ===
bot.start(async (ctx) => {
  const firstName = ctx.from.first_name || "there";

  const startGameLink = `https://t.me/MinimorphBot?startapp=${ctx.from.id}`;
  const howToPlayLink = 'https://minimorph.space/minimorph-telegram-game/';
  const communityLink = 'https://t.me/minimorph';

  const keyboard = {
    inline_keyboard: [
      [{ text: '🎰 Play Slot Machine', callback_data: 'play_slot' }],
      [{ text: '💳 Buy Slot Ticket', callback_data: 'buy_ticket' }],
      [{ text: '💰 Withdraw Stars', callback_data: 'withdraw_stars' }],
      [{ text: '👥 Join Community', url: communityLink }],
      [{ text: '🎮 Minimorph Game', url: startGameLink }],
      [{ text: '📘 How to Play', url: howToPlayLink }],
      [{ text: '⚔️ Start Battle (PvP)', callback_data: 'start_battle' }],
    ]
  };

  await ctx.reply(`👾 Hey 👋, ${firstName}! Welcome to Minimorph game!`, { reply_markup: keyboard });
});

// === Withdraw stars handler ===
bot.action('withdraw_stars', async (ctx) => {
  await ctx.answerCbQuery();
  const userRef = doc(db, "users", ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  if (!userSnap.exists()) return ctx.reply("⚠️ You don’t have any winnings yet.");

  const data = userSnap.data();
  const earned = data.slotEarnedStars || 0;
  if (earned < 100) return ctx.reply(`💡 Minimum withdrawal is 100 ⭐️. Current: ${earned} ⭐`);

  await updateDoc(userRef, {
    pendingPayoutStars: (data.pendingPayoutStars || 0) + earned,
    slotEarnedStars: 0,
  });

  await ctx.reply(`✅ Your payout request of ${earned} ⭐ has been queued.`);
  await bot.telegram.sendMessage(SLOT_ADMIN_ID, `💰 User @${ctx.from.username} requested withdrawal of ${earned} ⭐.`);
});

// === Battle commands ===
bot.action("start_battle", async (ctx) => {
  await ctx.answerCbQuery();
  const user = ctx.from;

  const keyboard = {
    inline_keyboard: [
      [
        { text: "💰 2 ⭐", callback_data: "pvp_prize_2" },
        { text: "💰 250 ⭐", callback_data: "pvp_prize_250" },
      ],
      [
        { text: "💎 500 ⭐", callback_data: "pvp_prize_500" }
      ],
      [
        { text: "🎯 Without Prize", callback_data: "pvp_prize_0" }
      ]
    ]
  };

  await ctx.reply(`⚔️ @${user.username || user.first_name}, choose your prize pool:`, { reply_markup: keyboard });
});

// Ping route
app.get("/", (req, res) => res.send("✅ Bot is running"));

// Start server & bot
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  await bot.launch();
  console.log("🤖 Bot launched with long polling");
});
