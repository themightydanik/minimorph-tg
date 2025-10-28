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
      [{ text: "💎 500 ⭐", callback_data: "pvp_prize_500" }],
      [{ text: "🎯 Without Prize", callback_data: "pvp_prize_0" }],
      [
        { text: "💳 Top Up Wallet 1", callback_data: "wallet_add_1" },
        { text: "💳 Top Up Wallet 125", callback_data: "wallet_add_125" },
        { text: "💳 Top Up Wallet 250", callback_data: "wallet_add_250" },
      ],
    ]
  };

  await ctx.reply(`⚔️ @${user.username || user.first_name}, choose your prize or top up Wallet:`, { reply_markup: keyboard });
});

// === Handle prize pool selection ===
bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const prizePool = parseInt(ctx.match[1]);
  const initiator = ctx.from;

  const battle = await createBattle(db, initiator, prizePool);

  if (prizePool === 0) {
    await updateBattle(db, battle.id, {
      initiatorPaid: true,
      opponentPaid: true,
      status: "paid_by_both"
    });
    await ctx.reply(`🎮 @${initiator.username || initiator.first_name}, your battle without prize is ready!`);
    await startBattle(bot, db, battle.id);
    return;
  }

  const userRef = doc(db, initiator.id.toString());
  const userSnap = await getDoc(userRef);
  const wallet = (userSnap.exists() && userSnap.data().wallet) || 0;

  if (wallet >= prizePool / 2) {
    await updateBattle(db, battle.id, { initiatorPaid: true });
    const keyboard = {
      inline_keyboard: [[{ text: "💸 Pay using Wallet", callback_data: `pay_wallet_${battle.id}` }]]
    };
    await ctx.reply(`💳 You have ${wallet} ⭐ in your Wallet. Pay for the battle:`, { reply_markup: keyboard });
  } else {
    const topupKeyboard = {
      inline_keyboard: [
        [{ text: "💳 Add 1 Star", callback_data: "wallet_add_1" }],
        [{ text: "💳 Add 125 Stars", callback_data: "wallet_add_125" }],
        [{ text: "💳 Add 250 Stars", callback_data: "wallet_add_250" }]
      ]
    };
    await ctx.reply(`💡 Your Wallet balance is ${wallet} ⭐. Top up to participate.`, { reply_markup: topupKeyboard });
  }
});

// === Pay using Wallet ===
bot.action(/^pay_wallet_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const battle = await getBattleById(db, battleId);
  if (!battle) return ctx.reply("⚠️ Battle not found.");

  const userRef = doc(db, ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  const wallet = (userSnap.exists() && userSnap.data().wallet) || 0;

  const needed = battle.prizePool / 2;
  if (wallet < needed) return ctx.reply(`⚠️ Not enough Wallet balance. Need ${needed} ⭐.`);

  await updateDoc(userRef, { wallet: wallet - needed });

  const updateData = {};
  if (ctx.from.id === battle.initiatorId) updateData.initiatorPaid = true;
  if (ctx.from.id === battle.opponentId) updateData.opponentPaid = true;
  await updateBattle(db, battleId, updateData);

  await ctx.reply(`✅ ${needed} ⭐ deducted from your Wallet. Ready to battle!`);

  const updatedBattle = await getBattleById(db, battleId);
  if (updatedBattle.initiatorPaid && updatedBattle.opponentPaid) {
    await updateBattle(db, battleId, { status: "paid_by_both" });
    await startBattle(bot, db, battleId);
  }
});

// Ping route
app.get("/", (req, res) => res.send("✅ Bot is running"));

// Start server & bot
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  await bot.launch();
  console.log("🤖 Bot launched with long polling");
});
