// index.js - Main Bot File with API Integration
import express from 'express';
import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import cors from 'cors';
import initSlotModule from "./slot.js";
import { db } from "./firebase.js";
import { handlePreCheckoutQuery, handleSuccessfulPayment, createBotSlotTicketInvoice, createMiniAppSlotInvoice } from "./paymentsHandler.js";
import apiRoutes from "./apiRoutes.js";
import { processReferral, handleReferralCommand } from "./referral.js";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);
const BOT_USERNAME = process.env.BOT_USERNAME || "minimorph_bot";

// ========================================
// CONFIGURATION
// ========================================

const config = {
  // Bot emoji 🎰 slot configuration
  SLOT_PRICE_STARS: parseInt(process.env.SLOT_PRICE_STARS || "20", 10),
  SLOT_TICKETS_PER_PURCHASE: parseInt(process.env.SLOT_TICKETS_PER_PURCHASE || "3", 10),
  SLOT_JACKPOT_REWARD: parseInt(process.env.SLOT_JACKPOT_REWARD || "100", 10),
  SLOT_PAIR_REWARD: parseInt(process.env.SLOT_PAIR_REWARD || "8", 10),
  SLOT_NEWBIE_SPINS: parseInt(process.env.SLOT_NEWBIE_SPINS || "9", 10),
  SLOT_NEWBIE_MULTIPLIER: parseFloat(process.env.SLOT_NEWBIE_MULTIPLIER || "1.3"),
  
  // Mini-App slot configuration
  MINIAPP_SLOT_PRICE: parseInt(process.env.MINIAPP_SLOT_PRICE || "1", 10),
  MINIAPP_SPINS_PER_PURCHASE: parseInt(process.env.MINIAPP_SPINS_PER_PURCHASE || "3", 10),
};

// ========================================
// PAYMENT HANDLERS
// ========================================

bot.on("pre_checkout_query", (ctx) => handlePreCheckoutQuery(ctx));
bot.on("successful_payment", (ctx) => handleSuccessfulPayment(ctx, config));

// ========================================
// MODULES INITIALIZATION
// ========================================

// Slot Machine Module
const slotRouter = initSlotModule(bot, config);
app.use("/api/slot", slotRouter);

// Делаем бота доступным в req.app.get('bot') для /api/shop/invoice
app.set("bot", bot);

// Health check для Render / Fly.io
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    bot: !!process.env.BOT_TOKEN,
    webhookUrl: process.env.WEBHOOK_URL || null,
    renderExternalUrl: process.env.RENDER_EXTERNAL_URL || null,
    webhookDomain: process.env.WEBHOOK_URL || process.env.RENDER_EXTERNAL_URL || null,
    nodeEnv: process.env.NODE_ENV || null,
    ts: Date.now()
  });
});

// Webhook endpoint (на случай если понадобится)
app.post('/tgwebhook', (req, res) => {
  bot.handleUpdate(req.body, res);
});

// API Routes for Mini-App
app.use("/api", apiRoutes);

// ========================================
// BOT COMMANDS
// ========================================

/**
 * /start command with referral support
 */
bot.command("start", async (ctx) => {
  const startPayload = ctx.message.text.split(" ")[1];
  
  // Process referral if present
  if (startPayload && startPayload.startsWith("ref_")) {
    const referrerId = startPayload.replace("ref_", "");
    await processReferral(ctx, referrerId);
  }
  
  await ctx.reply(
    `🚀 Welcome to Minimorph!\n\n` +
    `🎮 Play the slot machine with 🎰 emoji\n` +
    `📱 Open the Mini-App for more features\n` +
    `👥 Invite friends and earn rewards!\n\n` +
    `Use /help to see all commands`,
    {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎮 Open Mini-App", web_app: { url: process.env.MINIAPP_URL || "https://your-miniapp.com" } }],
          [{ text: "👥 Referral", callback_data: "referral" }]
        ]
      }
    }
  );
});

/**
 * /help command
 */
bot.command("help", async (ctx) => {
  await ctx.reply(
    `📚 Available Commands:\n\n` +
    `🎰 Slot Machine:\n` +
    `/buy_tickets - Buy tickets for emoji slot\n` +
    `Send 🎰 emoji to spin\n\n` +
    `👥 Referral:\n` +
    `/referral - Get your referral link\n\n` +
    `💼 Other:\n` +
    `/wallet - Check your wallet balance\n` +
    `/support - Contact support\n` +
    `/terms - Terms of use`
  );
});

/**
 * /referral command
 */
bot.command("referral", (ctx) => handleReferralCommand(ctx, BOT_USERNAME));

/**
 * /buy_tickets - Buy tickets for bot slot
 */
bot.command("buy_tickets", (ctx) => createBotSlotTicketInvoice(ctx, config));

/**
 * Callback: buy_ticket
 */
bot.action("buy_ticket", (ctx) => {
  ctx.answerCbQuery();
  createBotSlotTicketInvoice(ctx, config);
});

/**
 * Callback: referral
 */
bot.action("referral", (ctx) => {
  ctx.answerCbQuery();
  handleReferralCommand(ctx, BOT_USERNAME);
});

/**
 * /support command
 */
bot.command(["support", "paysupport"], async (ctx) => {
  await ctx.reply("💬 For support, contact @Deviola_programmer");
});

/**
 * /terms command
 */
bot.command("terms", async (ctx) => {
  await ctx.reply(
    `📜 Terms of Use:\n\n` +
    `1. Minimorph is a game with virtual rewards\n` +
    `2. Some features require Telegram Stars\n` +
    `3. Play responsibly\n` +
    `4. Contact support for help: @Deviola_programmer`
  );
});

/**
 * /wallet command
 */
bot.command("wallet", async (ctx) => {
  const telegramId = ctx.from.id.toString();
  
  try {
    const response = await fetch(`${process.env.API_BASE_URL || 'http://localhost:3000'}/api/balances/${telegramId}`);
    const balances = await response.json();
    
    await ctx.reply(
      `💰 Your Balances:\n\n` +
      `💎 Credits: ${balances.credits}\n` +
      `⚡ Energy: ${balances.energy}/60\n` +
      `🌟 Morph: ${balances.morph}`
    );
  } catch (err) {
    console.error("Wallet error:", err);
    await ctx.reply("⚠️ Error fetching wallet. Please try again.");
  }
});

// ========================================
// REST API ENDPOINTS
// ========================================

/**
 * POST /create-slot-invoice
 * Create invoice for Mini-App slot purchase
 */
app.post("/create-slot-invoice", async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    if (!telegramId) {
      return res.status(400).json({ error: "Missing telegramId" });
    }
    
    await createMiniAppSlotInvoice(bot, telegramId, config);
    
    res.json({ success: true });
  } catch (err) {
    console.error("Create slot invoice error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /health
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: Date.now() });
});

/**
 * GET /
 * Root endpoint
 */
app.get("/", (req, res) => {
  res.json({ 
    message: "Minimorph Bot API",
    version: "2.0.0",
    endpoints: {
      health: "/health",
      api: "/api/*",
      slot: "/api/slot/*",
      invoice: "/create-slot-invoice"
    }
  });
});

// ========================================
// ERROR HANDLERS
// ========================================

bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
  ctx.reply("⚠️ An error occurred. Please try again.").catch(() => {});
});

app.use((err, req, res, next) => {
  console.error("Express error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// ========================================
// START SERVER & BOT
// ========================================

// ── Запуск сервера ──
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`📱 Mini-App URL: ${process.env.MINIAPP_URL || 'Not configured'}`);
  console.log(`🤖 Bot: @${BOT_USERNAME}`);
  console.log('🎰 Slot machine: ACTIVE');
  console.log('👥 Referral system: ACTIVE');
  console.log('📊 API routes: ACTIVE');
});

// ── Запуск бота (polling) ──
// Сначала удаляем любой установленный webhook чтобы polling работал
bot.telegram.deleteWebhook().then(() => {
  return bot.launch();
}).then(() => {
  console.log('✅ Bot started successfully (polling mode)');
}).catch(err => {
  console.error('❌ Bot launch error:', err.message);
});

process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
