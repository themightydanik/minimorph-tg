// slot.js (v2) — Slot Machine with Telegram Stars payments
// Поддержка: - buyticket (Telegram Stars invoicing), - handle emoji 🎰 spins (dice.value),
// - auto payout of Stars on win via payments.sendStarsForm (low-level call),
// - admin commands: /grantpass, /freespin, admin HTTP endpoints.
//
// Зависимости: firebase (already in project), telegraf (already in project).
// Импортируй и инициализируй из index.js: see instructions below.

import express from "express";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  increment,
} from "firebase/firestore";

function initSlotModule({
  bot,
  db,
  ADMIN_ID,
  ADMIN_SECRET,
  PRICE_STARS = 20,
  TICKETS_PER_PURCHASE = 3,
  JACKPOT_REWARD = 100,
  PAIR_REWARD = 5,
  NEWBIE_SPINS = 9,
  NEWBIE_MULTIPLIER = 1.3,
}) {
  const router = express.Router();

  // --- HELPERS ---
  const normalizeId = (id) => id?.toString().replace(/^_+/, "") || null;

  const getUserById = async (telegramId) => {
    if (!telegramId) return null;
    const cleanId = normalizeId(telegramId);
    const ref = doc(db, "users", cleanId);
    const snap = await getDoc(ref);
    return snap.exists() ? { ref, data: snap.data(), id: cleanId } : null;
  };

  const getUserByUsername = async (username) => {
    if (!username) return null;
    const usersCol = collection(db, "users");
    const q = query(usersCol, where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const docSnap = snap.docs[0];
    const id = docSnap.id;
    return { ref: doc(db, "users", id), data: docSnap.data(), id };
  };

  const ensureSlotFields = async (userRef, currentData) => {
    const toSet = {};
    if (currentData.slotTickets === undefined) toSet.slotTickets = 0;
    if (currentData.slotSpentStars === undefined) toSet.slotSpentStars = 0;
    if (currentData.slotEarnedStars === undefined) toSet.slotEarnedStars = 0;
    if (currentData.slotWins === undefined) toSet.slotWins = 0;
    if (currentData.slotSpinsTotal === undefined) toSet.slotSpinsTotal = 0;
    if (Object.keys(toSet).length > 0) {
      await updateDoc(userRef, toSet);
      return { ...currentData, ...toSet };
    }
    return currentData;
  };

  // --- BOT COMMANDS ---

  // /slot - info
  bot.command("slot", async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const user = await getUserById(telegramId);
    if (!user) {
      return ctx.reply("User not found. Run /start.");
    }
    const data = await ensureSlotFields(user.ref, user.data);
    const tickets = data.slotTickets || 0;
    const msg = `🎰 Slot Machine\n\nTicket balance: ${tickets}\nPrice: ${PRICE_STARS} ⭐ per purchase (you get ${TICKETS_PER_PURCHASE} ticket(s)).\n\nPlay: Send emoji to chat 🎰 — Telegram will spin the slot.`;
    await ctx.reply(msg);
  });

  // /buyticket - отправим invoice для оплаты Stars
  bot.command("buyticket", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      const telegramId = ctx.from.id.toString();
      // unique payload
      const payload = `buy_ticket:${telegramId}:${Date.now()}`;

      // prices array: for Bot API we pass amounts in smallest currency units.
      // For Telegram Stars payments: per docs, provider_token should be omitted (pass empty string).
      // Use currency 'XTR' for Stars payments when using bot API methods that expect currency.
      // Many examples show passing empty provider token for Stars.
      const prices = [{ label: `${TICKETS_PER_PURCHASE} slot tickets`, amount: PRICE_STARS }];

      // Using bot.telegram.sendInvoice directly (provider token empty string for Stars).
      // Telegraf wrapper: bot.telegram.sendInvoice(chatId, title, description, payload, providerToken, startParameter, currency, prices)
      const title = `Buy ${TICKETS_PER_PURCHASE} slot ticket(s)`;
      const description = `${TICKETS_PER_PURCHASE} spins for the slot machine — cost ${PRICE_STARS} ⭐`;
      const providerToken = ""; // For Telegram Stars: provider token must be omitted/empty per Telegram docs.
      const startParameter = `buy_slot_${Date.now()}`;
      const currency = "XTR"; // Stars currency indicator; keep as per Telegram requirements.

      // Note: some Telegram/lib versions want prices amounts as integers in "cents"
      // but for Stars it's custom — these examples work in practice in many bots.
await bot.telegram.sendInvoice(chatId, {
  title: title,
  description: description,
  payload: payload,
  provider_token: providerToken, // пустая строка для Stars
  start_parameter: startParameter,
  currency: currency,
  prices: prices
});

    } catch (err) {
      console.error("buyticket error:", err);
      return ctx.reply("Error creating invoice. Contact the admin.");
    }
  });

  // Admin: /grantpass <@username|telegramId> <amount>
  bot.command("grantpass", async (ctx) => {
    const from = ctx.from.id.toString();
    if (from !== ADMIN_ID) return ctx.reply("Only admin can use this command.");
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args[0] || !args[1]) return ctx.reply("Usage: /grantpass @username|telegramId <amount>");
    const target = args[0].replace(/^@/, "");
    const amount = parseInt(args[1], 10) || 0;
    if (amount <= 0) return ctx.reply("Incorrect quantity.");
    try {
      let user = null;
      if (/^\d+$/.test(target)) {
        user = await getUserById(target);
        if (!user) return ctx.reply("User with this ID not found.");
        await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + amount });
        return ctx.reply(`✅ Issued ${amount} tickets to the user ${target}`);
      } else {
        const u = await getUserByUsername(target);
        if (!u) return ctx.reply("User with this username not found.");
        await updateDoc(u.ref, { slotTickets: (u.data.slotTickets || 0) + amount });
        return ctx.reply(`✅ Issued ${amount} tickets to the user @${target}`);
      }
    } catch (err) {
      console.error("grantpass error:", err);
      return ctx.reply("Error issuing tickets.");
    }
  });

  // Admin: /freespin - do a demo spin (no ticket consumed, no payout)
  bot.command("freespin", async (ctx) => {
    const from = ctx.from.id.toString();
    if (from !== ADMIN_ID) return ctx.reply("Only admin can use this command.");
    // create a simulated roll with random 1..64
    const val = Math.floor(Math.random() * 64) + 1;
    let outcome = "MISS";
    let reward = 0;
    if (val === 64) {
      outcome = "JACKPOT";
      reward = JACKPOT_REWARD;
    } else if (val >= 49) {
      outcome = "PAIR";
      reward = PAIR_REWARD;
    }
    return ctx.reply(`🎰 Demo spin\nValue: ${val}\nOutcome: ${outcome}\nReward (simulated): ${reward} ⭐\n(This is a demo, no real payments will be made.)`);
  });

  // --- PAYMENT HANDLERS (pre_checkout_query & successful_payment) ---
  // Note: Telegraf handles pre_checkout_query as update type 'pre_checkout_query'
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      // Always answer OK. You can validate payload here.
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("pre_checkout_query error:", err);
    }
  });

  // successful_payment comes inside message.successful_payment
  
// Тут вставляем вырезанный bot on message
// --- Handle successful payments ---
bot.on("successful_payment", async (ctx) => {
  try {
    const msg = ctx.message;
    const payload = msg.successful_payment.invoice_payload || "";
    const chatId = msg.chat.id;
    const payerId = msg.from.id.toString();

    if (payload.startsWith("buy_ticket:")) {
      const targetId = payerId;
      const user = await getUserById(targetId);
      if (!user) {
        await setDoc(doc(db, "users", targetId), {
          username: msg.from.username || `User-${targetId}`,
          slotTickets: TICKETS_PER_PURCHASE,
        });
      } else {
        await ensureSlotFields(user.ref, user.data);
        await updateDoc(user.ref, {
          slotTickets: (user.data.slotTickets || 0) + TICKETS_PER_PURCHASE,
          slotSpentStars: (user.data.slotSpentStars || 0) + PRICE_STARS,
        });
      }

      await bot.telegram.sendMessage(
        chatId,
        `✅ Purchase confirmed. You have been issued ${TICKETS_PER_PURCHASE} ticket(s).`
      );
    }
  } catch (err) {
    console.error("Error in successful_payment handler:", err);
  }
});

// --- Handle slot dice 🎰 only ---
bot.on("dice", async (ctx) => {
  try {
    const msg = ctx.message;
    if (msg.dice.emoji !== "🎰") return;

    const telegramId = msg.from.id.toString();
    const user = await getUserById(telegramId);
    if (!user) return ctx.reply("❗ You are not registered. Run /start.");

    const data = await ensureSlotFields(user.ref, user.data);

    if ((data.slotTickets || 0) <= 0) {
      return ctx.reply("You don't have any tickets. Buy /buyticket or ask admin for some.");
    }

    const val = msg.dice.value;
    const spinsTotal = data.slotSpinsTotal || 0;
    const isNewbie = spinsTotal < NEWBIE_SPINS;
    const basePairCount = 15;
    const pairCount = Math.min(63, Math.max(1, Math.floor(basePairCount * (isNewbie ? NEWBIE_MULTIPLIER : 1))));
    const pairThreshold = 64 - pairCount;

    let outcome = "MISS";
    let reward = 0;
    if (val === 64) {
      outcome = "JACKPOT";
      reward = JACKPOT_REWARD;
    } else if (val > pairThreshold) {
      outcome = "PAIR";
      reward = PAIR_REWARD;
    }

    await updateDoc(user.ref, {
      slotTickets: (data.slotTickets || 0) - 1,
      slotSpinsTotal: (data.slotSpinsTotal || 0) + 1,
      slotWins: (data.slotWins || 0) + (reward > 0 ? 1 : 0),
      slotEarnedStars: (data.slotEarnedStars || 0) + reward,
      pendingPayoutStars: (data.pendingPayoutStars || 0) + reward,
    });

    let replyText = `🎰 Result: ${outcome}\n`;
    if (reward > 0) {
      replyText += `💰 Congratulations, you won ${reward} ⭐!\n💵 Tap "Withdraw Stars" to receive your winnings.`;
      await ctx.reply(replyText);

      try {
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `🎯 User @${msg.from.username || msg.from.id} won ${reward} ⭐\nAdded to pending payout.`
        );
      } catch (notifyErr) {
        console.error("Failed to notify admin:", notifyErr);
      }
    } else {
      replyText += `😕 Sorry, didn't win anything. Try again!`;
      await ctx.reply(replyText);
    }
  } catch (err) {
    console.error("Error in dice handler:", err);
  }
});



  // --- ADMIN EXPRESS ROUTES ---

  // Grant tickets via HTTP POST
  // Body: { username?: "user", telegramId?: "123", amount: 5 }
  router.post("/admin/grant", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"];
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");
      const { username, telegramId, amount } = req.body;
      const qty = parseInt(amount, 10) || 0;
      if (!qty || qty <= 0) return res.status(400).send("Invalid amount");
      if (telegramId) {
        const user = await getUserById(telegramId);
        if (!user) return res.status(404).send("User not found");
        await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + qty });
        return res.send(`Granted ${qty} tickets to ${telegramId}`);
      } else if (username) {
        const uname = username.replace(/^@/, "");
        const user = await getUserByUsername(uname);
        if (!user) return res.status(404).send("User not found");
        await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + qty });
        return res.send(`Granted ${qty} tickets to @${uname}`);
      } else {
        return res.status(400).send("Provide username or telegramId");
      }
    } catch (err) {
      console.error("admin grant error:", err);
      res.status(500).send("Server error");
    }
  });

  // Admin endpoint to perform payout via Telegram API (manual fallback)
  // Body: { telegramId: "123", amount: 50 }
  router.post("/admin/payout-stars", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"];
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");
      const { telegramId, amount } = req.body;
      const amt = parseInt(amount, 10) || 0;
      if (!telegramId || !amt || amt <= 0) return res.status(400).send("Invalid data");

      // Attempt low-level API call
      try {
        await bot.telegram.callApi("payments.sendStarsForm", {
          user_id: parseInt(telegramId, 10),
          amount: amt,
        });
        // Update DB to reflect paid
        const user = await getUserById(telegramId);
        if (user) {
          await updateDoc(user.ref, {
            pendingPayoutStars: (user.data.pendingPayoutStars || 0) - amt,
          });
        }
        return res.send(`Payout ${amt} stars to ${telegramId} attempted`);
      } catch (callErr) {
        console.error("payout API error:", callErr);
        return res.status(500).send("Payout API call failed; check logs and Telegram config");
      }
    } catch (err) {
      console.error("admin payout error:", err);
      res.status(500).send("Server error");
    }
  });

  return router;
}

export default initSlotModule;

