// index.js (COMPLETE VERSION WITH MINIAPP SLOTS)
import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { createBattle, getBattleById, updateBattle } from "./pvp/pvpFirebase.js";
import { initPvpWalletPayments } from "./pvp/pvpWalletPayments.js";
import { startBattle } from "./pvp/pvpGameLogic.js";
import { initGameLogic } from "./pvp/pvpGameLogic.js";
import { initUnifiedPayments } from "./paymentsHandler.js";

dotenv.config();

const app = express();
app.use(express.json());

const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);
bot.db = db;

// === Constants ===
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "917309737";
const SLOT_ADMIN_SECRET = process.env.SLOT_ADMIN_SECRET || "SherbetLemon123@";
const SLOT_PRICE_STARS = parseInt(process.env.SLOT_PRICE_STARS || "20", 10);
const SLOT_TICKETS_PER_PURCHASE = parseInt(process.env.SLOT_TICKETS_PER_PURCHASE || "3", 10);

// 🎰 Mini-App Slot Constants
const MINIAPP_SLOT_PRICE = parseInt(process.env.MINIAPP_SLOT_PRICE || "1", 10);
const MINIAPP_SPINS_PER_PURCHASE = parseInt(process.env.MINIAPP_SPINS_PER_PURCHASE || "3", 10);

// === 🔥 UNIFIED PAYMENTS (обрабатывает ВСЕ платежи) ===
initUnifiedPayments({ 
  bot, 
  db, 
  PRICE_STARS: SLOT_PRICE_STARS,
  TICKETS_PER_PURCHASE: SLOT_TICKETS_PER_PURCHASE
});

// === Slot Module (БЕЗ обработчиков платежей) ===
const slotRouter = initSlotModule({
  bot,
  db,
  ADMIN_ID: SLOT_ADMIN_ID,
  ADMIN_SECRET: SLOT_ADMIN_SECRET,
  PRICE_STARS: SLOT_PRICE_STARS,
  TICKETS_PER_PURCHASE: SLOT_TICKETS_PER_PURCHASE,
  JACKPOT_REWARD: parseInt(process.env.SLOT_JACKPOT_REWARD || "100", 10),
  PAIR_REWARD: parseInt(process.env.SLOT_PAIR_REWARD || "8", 10),
  NEWBIE_SPINS: parseInt(process.env.SLOT_NEWBIE_SPINS || "9", 10),
  NEWBIE_MULTIPLIER: parseFloat(process.env.SLOT_NEWBIE_MULTIPLIER || "1.3"),
});
app.use("/slot", slotRouter);

// === PvP Wallet + Payments ===
initPvpWalletPayments({ bot, db });

// === PvP Game Logic ===
initGameLogic({ bot, db });

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

bot.command("wallet", async (ctx) => {
  const userRef = doc(db, "users", ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  
  const wallet = (userSnap.exists() && userSnap.data().wallet) || 0;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: "💳 Top Up Wallet", callback_data: "topup_wallet" }],
    ]
  };
  
  await ctx.reply(
    `💰 Your Wallet Balance: ${wallet} ⭐`,
    { reply_markup: keyboard }
  );
});

bot.action("topup_wallet", async (ctx) => {
  await ctx.answerCbQuery();
  await bot.showWalletTopupOptions(ctx);
});

// === /start handler ===
bot.start(async (ctx) => {
  const startParam = ctx.message.text.split(" ")[1];
  
  // 🎰 Mini-App Slot Purchase Handler
  if (startParam === "buy_slots") {
    const telegramId = ctx.from.id.toString();
    const payload = `slot_purchase_${telegramId}_${Date.now()}`;

    try {
      await ctx.replyWithInvoice({
        title: `Buy ${MINIAPP_SPINS_PER_PURCHASE} Slot Spins`,
        description: `Get ${MINIAPP_SPINS_PER_PURCHASE} spins for the Mini-App Slot Machine`,
        payload,
        provider_token: "",
        currency: "XTR",
        prices: [{ 
          label: `${MINIAPP_SPINS_PER_PURCHASE} Spins`, 
          amount: MINIAPP_SLOT_PRICE 
        }],
        start_parameter: "miniapp_slot"
      });
      
      console.log(`🎰 Mini-App slot invoice created for user ${telegramId}`);
      return; // ВАЖНО: выходим чтобы не показывать стандартное меню
    } catch (err) {
      console.error("Error creating Mini-App slot invoice:", err);
      return ctx.reply("⚠️ Error creating invoice. Please try again or contact @Deviola_programmer");
    }
  }

  // Стандартное приветствие
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
      [{ text: '💳 My Wallet', callback_data: 'check_wallet' }],
    ]
  };

  await ctx.reply(
    `👾 Hey 👋, ${firstName}! Welcome to Minimorph game!`,
    { reply_markup: keyboard }
  );
});

// === Slot Machine Handlers (Bot-based) ===
bot.action('play_slot', async (ctx) => {
  await ctx.answerCbQuery();
  const telegramId = ctx.from.id.toString();
  const userRef = doc(db, "users", telegramId);
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    return ctx.reply("❗ You are not registered. Run /start first.");
  }
  
  const data = userSnap.data();
  const tickets = data.slotTickets || 0;
  
  await ctx.reply(
    `🎰 Slot Machine\n\n` +
    `🎟️ Your tickets: ${tickets}\n` +
    `💰 Price: ${SLOT_PRICE_STARS} ⭐ per purchase (you get ${SLOT_TICKETS_PER_PURCHASE} ticket(s))\n\n` +
    `🎲 To play: Send the slot machine emoji 🎰 to the chat — Telegram will spin it automatically!`
  );
});

bot.action('buy_ticket', async (ctx) => {
  await ctx.answerCbQuery();
  
  try {
    const telegramId = ctx.from.id.toString();
    const payload = `buy_ticket:${telegramId}:${Date.now()}`;

    await ctx.replyWithInvoice({
      title: `Buy ${SLOT_TICKETS_PER_PURCHASE} slot ticket(s)`,
      description: `${SLOT_TICKETS_PER_PURCHASE} spins for the slot machine — cost ${SLOT_PRICE_STARS} ⭐`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: `${SLOT_TICKETS_PER_PURCHASE} slot tickets`, amount: SLOT_PRICE_STARS }],
      start_parameter: "buy_slot"
    });
  } catch (err) {
    console.error("buy_ticket error:", err);
    return ctx.reply("⚠️ Error creating invoice. Contact the admin.");
  }
});

// === Check Wallet ===
bot.action('check_wallet', async (ctx) => {
  await ctx.answerCbQuery();
  const userRef = doc(db, "users", ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  
  const wallet = (userSnap.exists() && userSnap.data().wallet) || 0;
  
  const keyboard = {
    inline_keyboard: [
      [{ text: "💳 Top Up Wallet", callback_data: "topup_wallet" }],
    ]
  };
  
  await ctx.reply(
    `💰 Your Wallet Balance: ${wallet} ⭐`,
    { reply_markup: keyboard }
  );
});

// === Withdraw stars handler ===
bot.action('withdraw_stars', async (ctx) => {
  await ctx.answerCbQuery();
  const userRef = doc(db, "users", ctx.from.id.toString());
  const userSnap = await getDoc(userRef);
  
  if (!userSnap.exists()) {
    return ctx.reply("⚠️ You don't have any winnings yet.");
  }

  const data = userSnap.data();
  const earned = data.slotEarnedStars || 0;
  
  if (earned < 100) {
    return ctx.reply(
      `💡 Minimum withdrawal is 100 ⭐.\n` +
      `Current winnings: ${earned} ⭐`
    );
  }

  await updateDoc(userRef, {
    pendingPayoutStars: (data.pendingPayoutStars || 0) + earned,
    slotEarnedStars: 0,
  });

  await ctx.reply(
    `✅ Your payout request of ${earned} ⭐ has been queued.\n` +
    `💬 Admin will process it soon.`
  );
  
  await bot.telegram.sendMessage(
    SLOT_ADMIN_ID,
    `💰 Withdrawal Request:\n` +
    `User: @${ctx.from.username || ctx.from.first_name}\n` +
    `Amount: ${earned} ⭐\n` +
    `User ID: ${ctx.from.id}`
  );
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

  await ctx.reply(
    `⚔️ @${user.username || user.first_name}, choose your prize pool:`,
    { reply_markup: keyboard }
  );
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
      status: "waiting_for_opponent",
      chatId: ctx.chat.id
    });

    const lobbyKeyboard = {
      inline_keyboard: [
        [{ text: "⚔️ Join Free Battle", callback_data: `accept_battle_${battle.id}` }]
      ]
    };

    await ctx.reply(
      `🎮 @${initiator.username || initiator.first_name}, your free battle is ready!\n` +
      `⏳ Waiting for an opponent...`,
      { reply_markup: lobbyKeyboard }
    );
    return;
  }

  await updateBattle(db, battle.id, { chatId: ctx.chat.id });

  const lobbyKeyboard = {
    inline_keyboard: [
      [{ text: "⚔️ Accept Challenge", callback_data: `accept_battle_${battle.id}` }]
    ]
  };
  
  await ctx.reply(
    `🏟️ Battle lobby created!\n` +
    `💰 Prize Pool: ${prizePool} ⭐\n` +
    `⏳ Waiting for opponent...`,
    { reply_markup: lobbyKeyboard }
  );
});

// === Accept battle ===
bot.action(/^accept_battle_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const battle = await getBattleById(db, battleId);
  
  if (!battle) {
    return ctx.reply("⚠️ Battle not found.");
  }
  
  if (battle.opponentId) {
    return ctx.reply("⚠️ Someone already accepted this battle.");
  }
  
  if (battle.initiatorId.toString() === ctx.from.id.toString()) {
    return ctx.reply("⚠️ You cannot accept your own battle!");
  }

  await updateBattle(db, battleId, { 
    opponentId: ctx.from.id, 
    opponentUsername: ctx.from.username || ctx.from.first_name 
  });

  if (battle.prizePool === 0) {
    await updateBattle(db, battleId, { status: "paid_by_both" });
    await startBattle(bot, db, battleId, battle.chatId);
    return;
  }

  const needed = battle.prizePool / 2;
  
  const initiatorRef = doc(db, "users", battle.initiatorId.toString());
  const opponentRef = doc(db, "users", ctx.from.id.toString());
  
  const initiatorSnap = await getDoc(initiatorRef);
  const opponentSnap = await getDoc(opponentRef);
  
  const initiatorWallet = (initiatorSnap.exists() && initiatorSnap.data().wallet) || 0;
  const opponentWallet = (opponentSnap.exists() && opponentSnap.data().wallet) || 0;

  const payKeyboard = {
    inline_keyboard: [
      [{ text: "💳 Pay using Wallet", callback_data: `pay_wallet_${battleId}` }]
    ]
  };

  await ctx.reply(
    `🎮 You joined the battle vs @${battle.initiatorUsername || "Initiator"}!\n` +
    `💰 Entry fee: ${needed} ⭐\n` +
    `💳 Your Wallet: ${opponentWallet} ⭐`,
    { reply_markup: payKeyboard }
  );

  if (opponentWallet < needed) {
    await bot.showWalletTopupOptions({ chat: { id: ctx.from.id }, from: ctx.from });
  }

  try {
    await bot.telegram.sendMessage(
      battle.initiatorId,
      `🎮 Opponent @${ctx.from.username || ctx.from.first_name} joined your battle!\n` +
      `💰 Entry fee: ${needed} ⭐\n` +
      `💳 Your Wallet: ${initiatorWallet} ⭐\n\n` +
      `⏳ Both players must pay to start the battle.`,
      { reply_markup: payKeyboard }
    );

    if (initiatorWallet < needed) {
      await bot.showWalletTopupOptions({ 
        chat: { id: battle.initiatorId }, 
        from: { id: battle.initiatorId } 
      });
    }
  } catch (err) {
    console.error("Error notifying initiator:", err);
  }
});

// === Pay using Wallet ===
bot.action(/^pay_wallet_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const battleId = ctx.match[1];
  const battle = await getBattleById(db, battleId);
  
  if (!battle) {
    return ctx.reply("⚠️ Battle not found.");
  }

  const needed = battle.prizePool / 2;
  const userIdStr = ctx.from.id.toString();
  const isInitiator = userIdStr === battle.initiatorId.toString();
  const isOpponent = userIdStr === battle.opponentId?.toString();

  if (!isInitiator && !isOpponent) {
    return ctx.reply("⚠️ You are not part of this battle.");
  }

  if (isInitiator && battle.initiatorPaid) {
    return ctx.reply("✅ You have already paid for this battle!");
  }
  if (isOpponent && battle.opponentPaid) {
    return ctx.reply("✅ You have already paid for this battle!");
  }

  const role = isInitiator ? "initiator" : "opponent";
  const result = await bot.deductFromWallet(ctx.from.id, needed, battleId, role);

  if (!result.success) {
    if (result.error === "Insufficient funds") {
      await ctx.reply(
        `⚠️ Insufficient funds!\n` +
        `💰 You need: ${needed} ⭐\n` +
        `💳 Your balance is lower.\n\n` +
        `Please top up your Wallet:`
      );
      await bot.showWalletTopupOptions(ctx);
    } else {
      await ctx.reply(
        "⚠️ Payment failed. Please try again or contact admin.\n" +
        "💬 Support: @Deviola_programmer"
      );
    }
    return;
  }

  const updateData = {};
  if (isInitiator) updateData.initiatorPaid = true;
  if (isOpponent) updateData.opponentPaid = true;
  await updateBattle(db, battleId, updateData);

  await ctx.reply(
    `✅ Payment successful!\n` +
    `💸 ${needed} ⭐ deducted from your Wallet.\n` +
    `💰 Current balance: ${result.newWallet} ⭐`
  );

  const updatedBattle = await getBattleById(db, battleId);
  
  if (updatedBattle.initiatorPaid && updatedBattle.opponentPaid) {
    await updateBattle(db, battleId, { status: "paid_by_both" });
    
    const chatId = updatedBattle.chatId;
    if (chatId) {
      try {
        await bot.telegram.sendMessage(
          chatId,
          `✅ Both players have paid!\n` +
          `🎮 Battle is ready to start...`
        );
      } catch (err) {
        console.error("Error sending payment confirmation:", err);
      }
    }
    
    await startBattle(bot, db, battleId, updatedBattle.chatId);
  } else {
    const waitingFor = updatedBattle.initiatorPaid ? "opponent" : "initiator";
    const waitingUsername = waitingFor === "opponent" 
      ? updatedBattle.opponentUsername 
      : updatedBattle.initiatorUsername;
    
    await ctx.reply(
      `⏳ Waiting for @${waitingUsername} to pay their entry fee...`
    );
  }
});

// === 🎰 Mini-App Slot Machine Handlers ===

// Callback action (альтернативный метод, если нужен)
bot.action(/^buy_miniapp_slots_(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  
  try {
    const telegramId = ctx.match[1];
    const payload = `slot_purchase_${telegramId}_${Date.now()}`;

    await ctx.replyWithInvoice({
      title: `Buy ${MINIAPP_SPINS_PER_PURCHASE} Slot Spins`,
      description: `Get ${MINIAPP_SPINS_PER_PURCHASE} spins for the Mini-App Slot Machine`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ 
        label: `${MINIAPP_SPINS_PER_PURCHASE} Spins`, 
        amount: MINIAPP_SLOT_PRICE 
      }],
      start_parameter: "miniapp_slot"
    });
    
    console.log(`🎰 Mini-App slot invoice created via callback for user ${telegramId}`);
  } catch (err) {
    console.error("Mini-App slot invoice error:", err);
    return ctx.reply("⚠️ Error creating invoice. Please try again or contact @Deviola_programmer");
  }
});

// REST API endpoint для создания инвойса из Mini-App
app.post("/create-slot-invoice", async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }

    const payload = `slot_purchase_${telegramId}_${Date.now()}`;

    const result = await bot.telegram.sendInvoice(
      telegramId,
      `Buy ${MINIAPP_SPINS_PER_PURCHASE} Slot Spins`,
      `Get ${MINIAPP_SPINS_PER_PURCHASE} spins for the Slot Machine`,
      payload,
      "",
      "XTR",
      [{ label: `${MINIAPP_SPINS_PER_PURCHASE} Spins`, amount: MINIAPP_SLOT_PRICE }],
      { start_parameter: "miniapp_slot" }
    );

    console.log(`🎰 Mini-App slot invoice created via API for user ${telegramId}`);

    res.json({ 
      success: true, 
      message: "Invoice sent",
      invoiceMessageId: result.message_id
    });

  } catch (error) {
    console.error("Error creating slot invoice:", error);
    res.status(500).json({ error: "Failed to create invoice" });
  }
});

// === Error handling ===
bot.catch((err, ctx) => {
  console.error("❌ Bot error:", err);
  try {
    ctx.reply(
      "⚠️ An error occurred. Please try again later.\n" +
      "💬 If the problem persists, contact @Deviola_programmer"
    );
  } catch {}
});

// === Routes ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

app.get("/health", (req, res) => {
  res.json({ 
    status: "ok", 
    timestamp: Date.now(),
    uptime: process.uptime()
  });
});

// === Start server & bot ===
app.listen(port, async () => {
  console.log(`🚀 Server listening on port ${port}`);
  console.log(`🎰 Mini-App Slot: ${MINIAPP_SLOT_PRICE} ⭐ for ${MINIAPP_SPINS_PER_PURCHASE} spins`);
  
  try {
    await bot.launch();
    console.log("🤖 Bot launched with long polling");
  } catch (err) {
    console.error("❌ Failed to launch bot:", err);
    process.exit(1);
  }
});

// === Graceful shutdown ===
process.once('SIGINT', () => {
  console.log("🛑 Received SIGINT, stopping bot...");
  bot.stop('SIGINT');
  process.exit(0);
});

process.once('SIGTERM', () => {
  console.log("🛑 Received SIGTERM, stopping bot...");
  bot.stop('SIGTERM');
  process.exit(0);
});
