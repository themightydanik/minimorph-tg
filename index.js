import express from 'express';
import referralRoute from "./referral.js";
import { Telegraf, Markup } from 'telegraf';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();
import initSlotModule from "./slot.js";

const app = express();
const port = process.env.PORT || 3000;
const bot = new Telegraf(process.env.BOT_TOKEN);

// после создания bot и app...
const SLOT_ADMIN_ID = process.env.SLOT_ADMIN_ID || "YOUR_ADMIN_TELEGRAM_ID";
const SLOT_ADMIN_SECRET = process.env.SLOT_ADMIN_SECRET || "replace-with-strong-secret";

const slotRouter = initSlotModule({
  bot,
  db,
  ADMIN_ID: SLOT_ADMIN_ID,
  ADMIN_SECRET: SLOT_ADMIN_SECRET,
  spinsPerTicket: 1,
  rewards: { jackpot: 100, pair: 5 }
});

app.use("/slot", slotRouter);

// Middleware
app.use(express.json());
app.use("/referral", referralRoute);

// Bot webhook endpoint
app.use(bot.webhookCallback("/telegram"));

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
      [{ text: '🎮 Start Game', url: startGameLink }],
      [{ text: '📘 How to Play', url: howToPlayLink }],
      [{ text: '👥 Join Community', url: communityLink }]
    ]
  };

  await ctx.reply(
    `👾 Hey 👋, ${ctx.from.first_name}! Welcome to Minimorph game!`,
    { reply_markup: keyboard }
  );
});

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
