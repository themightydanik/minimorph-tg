// slot.js (v3) — БЕЗ обработчиков платежей (они перенесены в paymentsHandler.js)
// Только игровая логика + admin команды

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
} from "firebase/firestore";

function initSlotModule({
  bot,
  db,
  ADMIN_ID,
  ADMIN_SECRET,
  PRICE_STARS = 20,
  TICKETS_PER_PURCHASE = 3,
  JACKPOT_REWARD = 100,
  PAIR_REWARD = 7,
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
      const telegramId = ctx.from.id.toString();
      const payload = `buy_ticket:${telegramId}:${Date.now()}`;

      await ctx.replyWithInvoice({
        title: `Buy ${TICKETS_PER_PURCHASE} slot ticket(s)`,
        description: `${TICKETS_PER_PURCHASE} spins for the slot machine — cost ${PRICE_STARS} ⭐`,
        payload,
        provider_token: "", // Stars
        currency: "XTR",
        prices: [{ label: `${TICKETS_PER_PURCHASE} slot tickets`, amount: PRICE_STARS }],
        start_parameter: "buy_slot"
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
    const val = Math.floor(Math.random() * 64) + 1;
    let outcome = "MISS";
    let reward = 0;

    if (val === 64) {
      outcome = "JACKPOT";
      reward = JACKPOT_REWARD;
    } else if (val >= 33 && val <= 63) {
      outcome = "PAIR";
      reward = PAIR_REWARD;
    } else {
      outcome = "MISS";
    }
    return ctx.reply(`🎰 Demo spin\nValue: ${val}\nOutcome: ${outcome}\nReward (simulated): ${reward} ⭐\n(This is a demo, no real payments will be made.)`);
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
      });

      let replyText = `🎰 Result: ${outcome}\n`;
      if (reward > 0) {
        if (outcome === "JACKPOT") {
          replyText = `🎰 Result: JACKPOT!!! 🍒 🍒 🍒\n💎 JACKPOT!!! 💎\nUnbelievable! You've unlocked the top reward — ${reward} ⭐!\n🚀 The stars align in your favor!`;
        } else {
          replyText = `🎰 Result: ${outcome}\n💰 Congratulations, you won ${reward} 💎 💎 🪐!\n💵 Tap "Withdraw Stars" to receive your winnings.`;
        }

        await ctx.reply(replyText);

        try {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            `🎯 User @${msg.from.username || msg.from.id} won ${reward} ⭐ (${outcome})\nAdded to pending payout.`
          );
        } catch (notifyErr) {
          console.error("Failed to notify admin:", notifyErr);
        }
      } else {
        replyText += `😕 Sorry, didn't win anything. Try again! 🍋 💀 🍉`;
        await ctx.reply(replyText);
      }

    } catch (err) {
      console.error("Error in dice handler:", err);
    }
  });

  // --- ADMIN EXPRESS ROUTES ---

  // Grant tickets via HTTP POST
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
  router.post("/admin/payout-stars", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"];
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");
      const { telegramId, amount } = req.body;
      const amt = parseInt(amount, 10) || 0;
      if (!telegramId || !amt || amt <= 0) return res.status(400).send("Invalid data");

      try {
        await bot.telegram.callApi("payments.sendStarsForm", {
          user_id: parseInt(telegramId, 10),
          amount: amt,
        });
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
