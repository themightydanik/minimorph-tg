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
initPvpWalletLogic({
  bot,
  db,
  onStarsPurchased: async (userId, amount) => {
    const userRef = doc(db, "users", userId.toString());
    const userSnap = await getDoc(userRef);
    const currentWallet = (userSnap.exists() && userSnap.data().wallet) || 0;
    await updateDoc(userRef, { wallet: currentWallet + amount });
  }
});

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
    ]
  };

  await ctx.reply(`⚔️ @${user.username || user.first_name}, choose your prize pool:`, { reply_markup: keyboard });
});

// === Handle prize pool selection ===
bot.action(/^pvp_prize_(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const prizePool = parseInt(ctx.match[1]);
  const initiator = ctx.from;

  // Создаём батл
  const battle = await createBattle(db, initiator, prizePool);

  if (prizePool === 0) {
    await updateBattle(db, battle.id, { initiatorPaid: true, opponentPaid: true, status: "paid_by_both" });
    await ctx.reply(`🎮 @${initiator.username || initiator.first_name}, your battle without prize is ready!`);
    await startBattle(bot, db, battle.id);
    return;
  }

  // Лобби
  const lobbyKeyboard = {
    inline_keyboard: [[{ text: "⚔️ Accept Challenge", callback_data: `accept_battle_${battle.id}` }]]
  };
  await ctx.reply(`🏟️ Battle lobby created with prize ${prizePool} ⭐. Waiting for opponent...`, { reply_markup: lobbyKeyboard });
});

// === Accept battle (оппонент) ===
bot.action(/^accept_battle_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const battle = await getBattleById(db, battleId);
  if (!battle) return ctx.reply("⚠️ Battle not found.");
  if (battle.opponentId) return ctx.reply("⚠️ Someone already accepted this battle.");

  // Назначаем оппонента
  await updateBattle(db, battleId, { opponentId: ctx.from.id, opponentUsername: ctx.from.username });

  const needed = battle.prizePool / 2;

  // Проверяем баланс инициатора
  const initiatorRef = doc(db, "users", battle.initiatorId.toString());
  const initiatorSnap = await getDoc(initiatorRef);
  const initiatorWallet = (initiatorSnap.exists() && initiatorSnap.data().wallet) || 0;

  // Показываем кнопку оплаты прямо в батле
  const payKeyboard = {
    inline_keyboard: [[{ text: "💳 Pay using Wallet", callback_data: `pay_wallet_${battleId}` }]]
  };

  await ctx.reply(
    `🎮 You joined the battle as opponent of @${battle.initiatorUsername || battle.initiatorName}! Waiting for initiator to pay...`,
    { reply_markup: payKeyboard }
  );

  // Отправляем уведомление инициатору
  await bot.telegram.sendMessage(
    battle.initiatorId,
    `🎮 Opponent @${ctx.from.username} joined! Pay your share to start the battle (${needed} ⭐). Current Wallet balance: ${initiatorWallet} ⭐`,
    { reply_markup: payKeyboard }
  );

  if (initiatorWallet < needed) {
    await bot.showWalletTopupOptions({ chat: { id: battle.initiatorId } });
  }
});

// === Pay using Wallet ===
bot.action(/^pay_wallet_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const battle = await getBattleById(db, battleId);
  if (!battle) return ctx.reply("⚠️ Battle not found.");

  const userRef = doc(db, "users", ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  const wallet = (userSnap.exists() && userSnap.data().wallet) || 0;
  const needed = battle.prizePool / 2;

  if (wallet < needed) {
    await bot.showWalletTopupOptions({ chat: { id: ctx.from.id } });
    return;
  }

  await updateDoc(userRef, { wallet: wallet - needed });

  const updateData = {};
  if (ctx.from.id === battle.initiatorId) updateData.initiatorPaid = true;
  if (ctx.from.id === battle.opponentId) updateData.opponentPaid = true;
  await updateBattle(db, battleId, updateData);

  await ctx.reply(`✅ ${needed} ⭐ deducted from your Wallet. Current balance: ${wallet - needed} ⭐`);

  const updatedBattle = await getBattleById(db, battleId);

  // Если инициатор оплатил, отправляем кнопку оппоненту
  if (updatedBattle.initiatorPaid && !updatedBattle.opponentPaid && ctx.from.id === updatedBattle.initiatorId) {
    const opponentId = updatedBattle.opponentId;
    const opponentRef = doc(db, "users", opponentId.toString());
    const opponentSnap = await getDoc(opponentRef);
    const opponentWallet = (opponentSnap.exists() && opponentSnap.data().wallet) || 0;

    const opponentKeyboard = {
      inline_keyboard: [[{ text: "💳 Pay using Wallet", callback_data: `pay_wallet_${battleId}` }]]
    };

    await bot.telegram.sendMessage(
      opponentId,
      `🎮 It's your turn to pay for the battle (${needed} ⭐). Current Wallet balance: ${opponentWallet} ⭐`,
      { reply_markup: opponentKeyboard }
    );

    if (opponentWallet < needed) {
      await bot.showWalletTopupOptions({ chat: { id: opponentId } });
    }
  }

  // Если оба оплатили, стартуем батл
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
