// pvpBattle.js — PvP battles module
// Usage: import initPvPModule from './pvpBattle.js' and call with { bot, db, ADMIN_ID, ADMIN_SECRET, COMMISSION_PERCENT }.
// Relies on Telegraf bot and Firestore (same style as your slot.js)

import express from "express";
import {
  collection,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
  getDocs,
  query,
  where,
  increment,
  runTransaction,
} from "firebase/firestore";

function initPvPModule({
  bot,
  db,
  ADMIN_ID,
  ADMIN_SECRET,
  COMMISSION_PERCENT = 16.6667, // example: 20 from 120 => ~16.6667%
  PRIZE_OPTIONS = [120, 250, 500], // available total prize pools
  INVOICE_CURRENCY = "XTR", // Stars
}) {
  const router = express.Router();

  const normalizeId = (id) => id?.toString().replace(/^_+/, "") || null;

  // --- Helpers for DB ---
  const battlesCol = collection(db, "TGBattles");
  const usersCol = collection(db, "users");

  async function getUserById(telegramId) {
    if (!telegramId) return null;
    const id = normalizeId(telegramId);
    const ref = doc(db, "users", id);
    const snap = await getDoc(ref);
    return snap.exists() ? { ref, data: snap.data(), id } : null;
  }

  async function getNextBattleNumber() {
    // Atomic increment counter at doc counters/battles
    const counterRef = doc(db, "counters", "battles");
    let nextNumber = null;
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      if (!snap.exists()) {
        tx.set(counterRef, { value: 1 });
        nextNumber = 1;
      } else {
        const cur = snap.data().value || 0;
        nextNumber = cur + 1;
        tx.update(counterRef, { value: nextNumber });
      }
    });
    return nextNumber;
  }

  function makeBattleDocId(num) {
    return `TGBattle${num}`;
  }

  // --- Create battle UI (command) ---
  // /pvp or /battle
  bot.command("battle", async (ctx) => {
    try {
      const chatId = ctx.chat.id;
      // Show prize options
      const keyboard = {
        inline_keyboard: PRIZE_OPTIONS.map((p) => [
          { text: `${p} ⭐ (total)`, callback_data: `pvp_selectPrize:${p}` },
        ]),
      };
      await ctx.reply(
        `⚔️ Create PVP Battle\nChoose prize fund (total). You will pay half now, the opponent will pay half when accepting.`,
        { reply_markup: keyboard }
      );
    } catch (err) {
      console.error("error /battle:", err);
    }
  });

  // --- User selected prize option ---
  bot.action(/pvp_selectPrize:(\d+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const prize = parseInt(ctx.match[1], 10);
      const initiator = ctx.from;
      const chatId = ctx.chat.id;

      // Create pending battle doc with status awaiting_initiator_payment
      const num = await getNextBattleNumber();
      const docId = makeBattleDocId(num);
      const battleRef = doc(db, "TGBattles", docId);
      const stakeEach = Math.floor(prize / 2);

      await setDoc(battleRef, {
        id: docId,
        createdAt: serverTimestamp(),
        chatId: chatId.toString(),
        prizeTotal: prize,
        stakeEach,
        emoji: "🎲", // default emoji — could allow choose later
        initiator: {
          id: initiator.id.toString(),
          username: initiator.username || null,
          first_name: initiator.first_name || null,
        },
        opponent: null,
        status: "awaiting_initiator_payment",
        initiatorPaid: false,
        opponentPaid: false,
        logs: [],
      });

      // Send invoice to initiator for half
      const payload = `pvp_pay:init:${docId}:${Date.now()}`;

      // Use same pattern as slot.js for invoice (Stars)
      try {
        await ctx.replyWithInvoice({
          title: `PVP Battle — pay your half (${stakeEach} ⭐)`,
          description: `Battle ${docId} — stake ${stakeEach} ⭐ (half of ${prize} ⭐). After payment your challenge will be posted.`,
          payload,
          provider_token: "",
          currency: INVOICE_CURRENCY,
          prices: [{ label: `${stakeEach} ⭐`, amount: stakeEach }],
          start_parameter: `pvp_${docId}`,
        });
      } catch (invErr) {
        console.error("invoice error:", invErr);
        // fallback: mark pending and instruct manual payment
        await ctx.reply(
          `Unable to create invoice automatically. Your battle ${docId} was saved. Admin will check payment.`
        );
      }

      await ctx.reply(`✅ Battle ${docId} created. An invoice for ${stakeEach} ⭐ was sent to you. After payment your challenge will be posted.`);
    } catch (err) {
      console.error("pvp_selectPrize error:", err);
    }
  });

  // --- Successful payments handler (listen to successful_payment in main bot) ---
  // We rely on the main bot's existing 'successful_payment' handler to be present.
  // But to centralize: add a handler here too — same style as slot.js uses bot.on("successful_payment", ...)
  bot.on("successful_payment", async (ctx) => {
    try {
      const payload = ctx.message.successful_payment?.invoice_payload || "";
      if (!payload.startsWith("pvp_pay:")) return; // not our invoice
      const parts = payload.split(":");
      // payload format: pvp_pay:init:<docId>:<ts>  OR pvp_pay:join:<docId>:<ts>
      const action = parts[1];
      const docId = parts[2];
      const payerId = ctx.from.id.toString();
      const payerUsername = ctx.from.username || null;
      const chatId = ctx.chat.id;

      const battleRef = doc(db, "TGBattles", docId);
      const battleSnap = await getDoc(battleRef);
      if (!battleSnap.exists()) {
        console.error("Payment for non-existing battle:", docId);
        return;
      }
      const battle = battleSnap.data();

      if (action === "init") {
        // mark initiatorPaid true, publish challenge message with Accept button
        if (battle.initiator.id !== payerId) {
          // paid by someone else — flag/record
          console.warn("Initiator payload paid by other user:", payerId);
        }
        await updateDoc(battleRef, {
          initiatorPaid: true,
          status: "waiting_for_opponent",
          [`logs`]: (battle.logs || []).concat([`initiatorPaid:${payerId}:${Date.now()}`]),
        });

        // Publish challenge message in the chat
        const acceptKeyboard = {
          inline_keyboard: [
            [
              { text: `✅ Accept ${battle.prizeTotal} ⭐`, callback_data: `pvp_accept:${docId}` },
            ],
            [
              { text: `❌ Cancel challenge`, callback_data: `pvp_cancel:${docId}` },
            ],
          ],
        };

        await bot.telegram.sendMessage(
          battle.chatId,
          `⚔️ Battle posted by @${battle.initiator.username || battle.initiator.id}!\nPrize fund: ${battle.prizeTotal} ⭐ (each pays ${battle.stakeEach} ⭐).\nPress "Accept" to join and pay your half.`,
          { reply_markup: acceptKeyboard }
        );

        // notify admin
        try {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            `📣 New PVP created: ${docId} by @${battle.initiator.username || battle.initiator.id} — prize ${battle.prizeTotal} ⭐. Waiting for opponent.`
          );
        } catch (notifyErr) {
          console.error("Notify admin error:", notifyErr);
        }

      } else if (action === "join") {
        // mark opponentPaid true and set opponent info
        if (battle.status !== "waiting_for_opponent") {
          // may be already joined
          console.warn("Join payment but battle status:", battle.status);
        }
        const opponentObj = {
          id: payerId,
          username: payerUsername,
          first_name: ctx.from.first_name || null,
        };

        await updateDoc(battleRef, {
          opponent: opponentObj,
          opponentPaid: true,
          status: "ready",
          [`logs`]: (battle.logs || []).concat([`opponentPaid:${payerId}:${Date.now()}`]),
          startedAt: serverTimestamp(),
          nextTurn: battle.initiator.id, // initiator moves first
          lastMoveAt: null,
          round: 0,
        });

        // Announce start and provide Roll button for initiator
        const startKeyboard = {
          inline_keyboard: [
            [{ text: `🎲 Roll (${battle.initiator.username || battle.initiator.id})`, callback_data: `pvp_roll:${docId}` }],
            [{ text: `❌ Forfeit`, callback_data: `pvp_forfeit:${docId}` }],
          ],
        };

        await bot.telegram.sendMessage(
          battle.chatId,
          `🏁 Battle ${docId} ready!\nPlayers:\n1) @${battle.initiator.username || battle.initiator.id}\n2) @${opponentObj.username || opponentObj.id}\nPrize: ${battle.prizeTotal} ⭐ (each paid ${battle.stakeEach} ⭐)\n\n@${battle.initiator.username || battle.initiator.id} — you move first. Press "Roll" to make your move.`,
          { reply_markup: startKeyboard }
        );

        // notify admin
        try {
          await bot.telegram.sendMessage(
            ADMIN_ID,
            `🚀 PVP start: ${docId} between @${battle.initiator.username || battle.initiator.id} and @${opponentObj.username || opponentObj.id}. Prize ${battle.prizeTotal} ⭐.`
          );
        } catch (notifyErr) {
          console.error("Notify admin error:", notifyErr);
        }
      }
    } catch (err) {
      console.error("pvp successful_payment handler error:", err);
    }
  });

  // --- Accept button handler (creates invoice for opponent) ---
  bot.action(/pvp_accept:(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const docId = ctx.match[1];
      const battleRef = doc(db, "TGBattles", docId);
      const snap = await getDoc(battleRef);
      if (!snap.exists()) return ctx.reply("Battle not found.");
      const battle = snap.data();

      // Prevent initiator from accepting their own fight
      if ((ctx.from.id || "").toString() === battle.initiator.id) {
        return ctx.reply("You are the initiator — wait for someone else to accept.");
      }
      if (battle.opponent && battle.opponent.id) {
        return ctx.reply("This battle already has an opponent or someone already purchased the join fee.");
      }
      if (!battle.initiatorPaid) {
        return ctx.reply("Initiator hasn't finished payment yet.");
      }
      // Send invoice to accepter for stakeEach
      const payload = `pvp_pay:join:${docId}:${Date.now()}`;
      try {
        await ctx.replyWithInvoice({
          title: `PVP Battle — pay your half (${battle.stakeEach} ⭐)`,
          description: `Joining ${docId} — stake ${battle.stakeEach} ⭐ (half of ${battle.prizeTotal} ⭐).`,
          payload,
          provider_token: "",
          currency: INVOICE_CURRENCY,
          prices: [{ label: `${battle.stakeEach} ⭐`, amount: battle.stakeEach }],
          start_parameter: `pvp_join_${docId}`,
        });
      } catch (invErr) {
        console.error("invoice error for join:", invErr);
        // fallback: inform admin
        await ctx.reply("Unable to create invoice automatically. Contact admin to join.");
      }
    } catch (err) {
      console.error("pvp_accept error:", err);
    }
  });

  // --- Cancel by initiator before opponent pays ---
  bot.action(/pvp_cancel:(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const docId = ctx.match[1];
      const snap = await getDoc(doc(db, "TGBattles", docId));
      if (!snap.exists()) return ctx.reply("Battle not found.");
      const battle = snap.data();
      if ((ctx.from.id || "").toString() !== battle.initiator.id) {
        return ctx.reply("Only the initiator can cancel the challenge.");
      }
      if (battle.initiatorPaid && !battle.opponentPaid) {
        // mark for refund: add refund entry for initiator
        await updateDoc(doc(db, "TGBattles", docId), {
          status: "cancelled",
          cancelledAt: serverTimestamp(),
          refundableTo: battle.initiator.id,
          [`logs`]: (battle.logs || []).concat([`cancelled_by_initiator:${battle.initiator.id}:${Date.now()}`]),
        });
        await ctx.reply(`❌ Battle ${docId} cancelled. Initiator payment will be marked for refund (admin will process).`);
        // notify admin
        await bot.telegram.sendMessage(ADMIN_ID, `❗ Battle ${docId} cancelled by initiator. Refund ${battle.stakeEach} ⭐ to @${battle.initiator.username || battle.initiator.id}.`);
      } else {
        await ctx.reply("Cannot cancel at this stage.");
      }
    } catch (err) {
      console.error("pvp_cancel error:", err);
    }
  });

  // --- Forfeit handler (during battle) ---
  bot.action(/pvp_forfeit:(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const docId = ctx.match[1];
      const bRef = doc(db, "TGBattles", docId);
      const snap = await getDoc(bRef);
      if (!snap.exists()) return ctx.reply("Battle not found.");
      const battle = snap.data();
      const uid = (ctx.from.id || "").toString();

      if (battle.status !== "ready" && battle.status !== "in_progress") {
        return ctx.reply("Battle is not active.");
      }
      // if one forfeits, other wins automatically
      const opponentId = battle.initiator.id === uid ? (battle.opponent?.id) : battle.initiator.id;
      const opponentUsername = battle.initiator.id === uid ? (battle.opponent?.username) : (battle.initiator.username);

      await updateDoc(bRef, {
        status: "finished",
        winnerId: opponentId,
        winnerUsername: opponentUsername || null,
        finishedAt: serverTimestamp(),
        result: `forfeit by ${uid}`,
        [`logs`]: (battle.logs || []).concat([`forfeit:${uid}:${Date.now()}`]),
      });

      await bot.telegram.sendMessage(battle.chatId, `⚠️ @${ctx.from.username || uid} forfeited. Winner: @${opponentUsername || opponentId}. Prize awaits admin payout.`);
      await bot.telegram.sendMessage(ADMIN_ID, `🏁 Battle ${docId} finished by forfeit. Winner: @${opponentUsername || opponentId}. Prize ${battle.prizeTotal} ⭐. Please process payout.`);
    } catch (err) {
      console.error("pvp_forfeit error:", err);
    }
  });

  // --- Roll handler (core game logic) ---
  bot.action(/pvp_roll:(.+)/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const docId = ctx.match[1];
      const bRef = doc(db, "TGBattles", docId);
      const snap = await getDoc(bRef);
      if (!snap.exists()) return ctx.reply("Battle not found.");
      const battle = snap.data();
      const uid = (ctx.from.id || "").toString();

      if (battle.status !== "ready" && battle.status !== "in_progress") {
        return ctx.reply("Battle is not ready.");
      }
      // both must have paid
      if (!battle.initiatorPaid || !battle.opponentPaid) {
        return ctx.reply("Both players haven't paid yet.");
      }

      // determine if this user is one of the players
      if (uid !== battle.initiator.id && uid !== (battle.opponent && battle.opponent.id)) {
        return ctx.reply("You are not a participant in this battle.");
      }

      // check turn
      if (!battle.nextTurn) {
        return ctx.reply("Turn info missing; admin intervention required.");
      }
      if (battle.nextTurn !== uid) {
        // tell who should move
        const next = battle.nextTurn === battle.initiator.id ? battle.initiator : battle.opponent;
        return ctx.reply(`Wait — now it's @${next.username || next.id} turn to roll.`);
      }

      // Enforce 7 seconds gap for second player's move after initiator's move
      if (battle.round > 0 && uid === (battle.opponent && battle.opponent.id)) {
        const lastMoveAt = battle.lastMoveAt ? battle.lastMoveAt.toMillis ? battle.lastMoveAt.toMillis() : battle.lastMoveAt : 0;
        const now = Date.now();
        const elapsed = now - lastMoveAt;
        const required = 7000;
        if (elapsed < required) {
          const remain = Math.ceil((required - elapsed) / 1000);
          return ctx.reply(`You must wait ${remain} more second(s) before rolling (game rule).`);
        }
      }

      // perform dice roll by bot to ensure we receive value
      // Use the chat where the battle was created
      const diceEmoji = battle.emoji || "🎲";

      const msg = await bot.telegram.sendDice(battle.chatId, diceEmoji);
      // msg.dice.value available
      const val = msg.dice.value;

      // record roll: if round === 0 -> it's initiator roll; else opponent roll
      const isInitiator = uid === battle.initiator.id;
      const round = (battle.round || 0) + 1;
      const fieldName = isInitiator ? `initiatorRolls` : `opponentRolls`;
      const updates = {
        round,
        lastMoveAt: serverTimestamp(),
        status: "in_progress",
        [`logs`]: (battle.logs || []).concat([`roll:${uid}:${val}:${Date.now()}`]),
      };
      // append roll value to arrays (Firestore doesn't support array concat atomic easily without arrayUnion; use update with arrayUnion)
      // but to keep it simple we'll store last roll values and also store bothRolls
      if (isInitiator) {
        updates.initiatorLastRoll = val;
        updates.nextTurn = battle.opponent.id;
      } else {
        updates.opponentLastRoll = val;
        updates.nextTurn = battle.initiator.id; // reset for next round if any
      }
      await updateDoc(bRef, updates);

      // Announce the roll
      await bot.telegram.sendMessage(battle.chatId, `🎲 @${ctx.from.username || uid} rolled: ${val}`);

      // If both have rolled at least once, determine winner (we do simple compare of last rolls)
      const freshSnap = await getDoc(bRef);
      const fresh = freshSnap.data();

      if (fresh.initiatorLastRoll !== undefined && fresh.opponentLastRoll !== undefined) {
        const iVal = fresh.initiatorLastRoll;
        const oVal = fresh.opponentLastRoll;
        let winnerId = null;
        let winnerUsername = null;
        if (iVal > oVal) {
          winnerId = fresh.initiator.id;
          winnerUsername = fresh.initiator.username || null;
        } else if (oVal > iVal) {
          winnerId = fresh.opponent.id;
          winnerUsername = fresh.opponent.username || null;
        } else {
          // tie -> handle tie rule: we can declare tie and refund or reroll both
          // For now: declare tie and schedule rematch (both re-roll). We'll reset lastRolls and set status ready.
          await updateDoc(bRef, {
            status: "ready",
            initiatorLastRoll: null,
            opponentLastRoll: null,
            round: 0,
            [`logs`]: (fresh.logs || []).concat([`tie:${iVal}:${oVal}:${Date.now()}`]),
            nextTurn: fresh.initiator.id,
          });
          await bot.telegram.sendMessage(battle.chatId, `🔁 It's a tie (${iVal} vs ${oVal}). Re-roll! @${fresh.initiator.username || fresh.initiator.id} goes first.`);
          return;
        }

        // compute payouts
        const prizeTotal = fresh.prizeTotal || 0;
        const commission = Math.round((prizeTotal * (COMMISSION_PERCENT / 100)) || 0);
        const winnerAmount = prizeTotal - commission;

        // update battle doc as finished
        await updateDoc(bRef, {
          status: "finished",
          finishedAt: serverTimestamp(),
          winnerId,
          winnerUsername,
          winnerAmount,
          commission,
          result: { initiator: iVal, opponent: oVal },
          [`logs`]: (fresh.logs || []).concat([`finished:${winnerId}:${winnerAmount}:${Date.now()}`]),
        });

        // announce winner
        await bot.telegram.sendMessage(
          battle.chatId,
          `🏆 Battle ${docId} finished!\nResults: @${fresh.initiator.username || fresh.initiator.id} — ${iVal}\n@${fresh.opponent.username || fresh.opponent.id} — ${oVal}\n\n🏅 Winner: @${winnerUsername || winnerId}\nPrize (after commission ${commission} ⭐): ${winnerAmount} ⭐.\n\nAdmin will process Stars payout manually.`
        );

        // notify admin with exact instructions
        await bot.telegram.sendMessage(
          ADMIN_ID,
          `🔔 PVP finished: ${docId}\nPlayers: @${fresh.initiator.username || fresh.initiator.id} vs @${fresh.opponent.username || fresh.opponent.id}\nWinner: @${winnerUsername || winnerId}\nPrize total: ${prizeTotal} ⭐ — winner receives: ${winnerAmount} ⭐, commission: ${commission} ⭐.\nDB path: TGBattles/${docId}`
        );

        return;
      }

    } catch (err) {
      console.error("pvp_roll error:", err);
    }
  });

  // --- Admin endpoint: mark payout done (optional) ---
  // POST /admin/mark-paid { battleId: 'TGBattle1', amount: 100, telegramId: 'xxx' }
  router.post("/admin/mark-paid", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"];
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");
      const { battleId, amount, telegramId } = req.body;
      if (!battleId || !amount || !telegramId) return res.status(400).send("Missing fields");
      const bRef = doc(db, "TGBattles", battleId);
      const snap = await getDoc(bRef);
      if (!snap.exists()) return res.status(404).send("Battle not found");
      await updateDoc(bRef, {
        payoutMarkedAt: serverTimestamp(),
        payoutMarkedAmount: parseInt(amount, 10),
        payoutMarkedTo: telegramId,
        payoutProcessedBy: ADMIN_ID,
        [`logs`]: (snap.data().logs || []).concat([`payout_marked:${telegramId}:${amount}:${Date.now()}`]),
      });
      return res.send("Marked payout in DB");
    } catch (err) {
      console.error("admin mark-paid error:", err);
      res.status(500).send("Server error");
    }
  });

  return router;
}

export default initPvPModule;
