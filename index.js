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
// ... оставляем как есть, все try/catch блоки сохранил

// === Ping route ===
app.get("/", (req, res) => res.send("✅ Bot is running"));

// === Prevent Replit sleep (используй свой Replit URL) ===
setInterval(() => {
  fetch(`https://${process.env.REPL_SLUG}.${process.env.REPL_OWNER}.repl.co/`).catch(() => {});
}, 5 * 60 * 1000);

// === Start Express server & launch bot ===
const server = app.listen(port, async () => {
  console.log(`🚀 Express server listening on port ${port}`);

  try {
    // Удаляем webhook если был (для безопасности)
    await bot.telegram.deleteWebhook();
    // Лонч бота через long polling
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

// === Отлов ошибки порта, если Replit пытается перезапустить ===
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.warn(`⚠️ Port ${port} is already in use. Maybe a previous instance is running.`);
  } else {
    console.error(err);
  }
});
