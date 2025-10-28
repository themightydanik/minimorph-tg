import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { createBattle, getBattleById, updateBattle } from "./pvp/pvpFirebase.js";
import { sendPaymentRequest } from "./pvp/pvpPayments.js";
import { startBattle } from "./pvp/pvpGameLogic.js";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);

// === Constants ===
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "917309737";
const SLOT_ADMIN_SECRET = process.env.SLOT_ADMIN_SECRET || "SherbetLemon123@";

// === Slot Machine Module ===
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

// === Global Commands ===
bot.command(["support", "paysupport"], async (ctx) => {
  await ctx.reply("💬 For support, please contact @Deviola_programmer.");
});

bot.command("terms", async (ctx) => {
  await ctx.reply(
    "📜 Terms of Use:\n" +
    "1. Slot and Battle games require Telegram Stars payments.\n" +
    "2. Rewards are manually processed.\n" +
    "3. Gamble responsibly.\n" +
    "4. Contact @Deviola_programmer for help."
  );
});

// === /start handler ===
bot.start(async (ctx) => {
  const telegramId = ctx.from.id.toString();
  const firstName = ctx.from.first_name || "there";

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
      [{ text: '⚔️ Start Battle (PvP)', callback_data: 'start_battle' }],
    ]
  };

  await ctx.reply(`👾 Hey 👋, ${firstName}! Welcome to Minimorph game!`, { reply_markup: keyboard });
});

// === Withdraw stars handler ===
bot.action('withdraw_stars', async (ctx) => {
  try {
    await ctx.answerCbQuery();
    const userRef = doc(db, "users", ctx.from.id.toString());
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return ctx.reply("⚠️ You don’t have any winnings yet.");

    const data = userSnap.data();
    const earned = data.slotEarnedStars || 0;
    if (earned < 100) return ctx.reply(`💡 Minimum withdrawal is 100 ⭐️. Current: ${earned} ⭐️`);

    await updateDoc(userRef, {
      pendingPayoutStars: (data.pendingPayoutStars || 0) + earned,
      slotEarnedStars: 0,
    });

    await ctx.reply(`✅ Your payout request of ${earned} ⭐️ has been queued.`);
    await bot.telegram.sendMessage(SLOT_ADMIN_ID, `💰 User @${ctx.from.username} requested withdrawal of ${earned} ⭐️.`);
  } catch (err) {
    console.error(err);
    await ctx.reply("🚫 Error during withdrawal. Try later.");
  }
});

// === PvP Handlers (встроенные) ===

// Показать выбор призового фонда
async function showBattlePrizePool(ctx) {
  const user = ctx.from;
  const keyboard = {
    inline_keyboard: [
      [
        { text: "💰 2 ⭐", callback_data: "pvp_prize_2" },
        { text: "💰 250 ⭐", callback_data: "pvp_prize_250" },
      ],
      [{ text: "💎 Prize Pool: 500 ⭐", callback_data: "pvp_prize_500" }],
    ],
  };
  await ctx.reply(`⚔️ @${user.username || user.first_name}, choose your prize pool:`, { reply_markup: keyboard });
}

// === /battle command ===
bot.command("battle", showBattlePrizePool);

// === Start Battle button ===
bot.action("start_battle", async (ctx) => {
  await ctx.answerCbQuery();
  await showBattlePrizePool(ctx);
});

// === Choose prize pool ===
bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const prizePool = parseInt(ctx.match[1]);
  const initiator = ctx.from;

  const battle = await createBattle(db, initiator, prizePool);

  const acceptKeyboard = {
    inline_keyboard: [
      [{ text: "✅ Accept Battle", callback_data: `pvp_accept_${battle.id}` }],
    ],
  };

  await ctx.reply(
    `🎯 @${initiator.username || initiator.first_name} has created a battle!\nPrize fund: ${prizePool} ⭐\n( ${prizePool / 2} ⭐ each)\nWaiting for opponent...`,
    { reply_markup: acceptKeyboard }
  );
});

// === Opponent accepts battle ===
bot.action(/^pvp_accept_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const opponent = ctx.from;

  const battle = await getBattleById(db, battleId);
  if (!battle) return ctx.reply("⚠️ Battle no longer active.");
  if (battle.status !== "awaiting_accept") return ctx.reply("⚠️ Battle already started or finished.");

  await updateBattle(db, battleId, {
    opponentId: opponent.id,
    opponentUsername: opponent.username,
    status: "awaiting_payment_initiator",
  });

  await sendPaymentRequest(ctx, battleId, "initiator", battle.prizePool / 2);

  await ctx.reply(`💡 @${opponent.username}, waiting for organizer's payment.`);
});

// === Ping route ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

// === Start server & bot ===
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  await bot.launch();
  console.log("🤖 Bot launched with long polling");
});
