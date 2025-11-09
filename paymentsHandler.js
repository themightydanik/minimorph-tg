// paymentsHandler.js - UPDATED WITH MINIAPP SLOT SUPPORT
// Обрабатывает ВСЕ платежи: wallet_topup, buy_ticket, pvp_*, slot_purchase (Mini-App)
import { doc, getDoc, setDoc, updateDoc, runTransaction, increment } from "firebase/firestore";
import { updateBattle, getBattleById } from "./pvp/pvpFirebase.js";

/**
 * 🎯 ЕДИНЫЙ обработчик всех платежей в боте
 */
export function initUnifiedPayments({ bot, db, PRICE_STARS, TICKETS_PER_PURCHASE }) {
  
  // --- ✅ Pre-checkout (разрешаем все платежи) ---
  bot.on("pre_checkout_query", async (ctx) => {
    try {
      await ctx.answerPreCheckoutQuery(true);
    } catch (err) {
      console.error("Pre-checkout error:", err);
    }
  });

  // --- 💸 Обработка успешных платежей (UNIFIED) ---
  bot.on("successful_payment", async (ctx) => {
    try {
      const payment = ctx.message.successful_payment;
      const payload = payment.invoice_payload || "";
      const chatId = ctx.message.chat.id;
      const payerId = ctx.message.from.id.toString();

      console.log("💰 Payment received:", payload);

      // === 1️⃣ WALLET TOP-UP ===
      if (payload.startsWith("wallet_topup:")) {
        await handleWalletTopup(bot, db, payload, payerId, payment, ctx);
        return;
      }

      // === 2️⃣ SLOT TICKETS (for bot-based slot game) ===
      if (payload.startsWith("buy_ticket:")) {
        await handleSlotTicketPurchase(
          bot, 
          db, 
          payload, 
          payerId, 
          chatId, 
          ctx.message.from,
          PRICE_STARS,
          TICKETS_PER_PURCHASE
        );
        return;
      }

      // === 3️⃣ MINI-APP SLOT SPINS ===
      if (payload.startsWith("slot_purchase_")) {
        await handleMiniAppSlotPurchase(bot, db, payload, payerId, payment, ctx);
        return;
      }

      // === 4️⃣ PVP BATTLE ===
      if (payload.startsWith("pvp_")) {
        await handlePvpPayment(bot, db, payload, payerId, ctx);
        return;
      }

      console.warn("⚠️ Unknown payment type:", payload);

    } catch (err) {
      console.error("❌ Payment handling error:", err);
      try {
        await ctx.reply("⚠️ Payment error. Please contact admin.");
      } catch {}
    }
  });
}

/**
 * 💳 Обработка пополнения Wallet
 */
async function handleWalletTopup(bot, db, payload, userId, payment, ctx) {
  const [, uid, amountStr, timestamp] = payload.split(":");
  const amount = parseInt(amountStr, 10);
  
  // 🔒 Защита от дублирования
  const transactionId = `topup_${userId}_${timestamp}`;
  const transactionRef = doc(db, "transactions", transactionId);
  const transactionSnap = await getDoc(transactionRef);
  
  if (transactionSnap.exists()) {
    console.warn(`⚠️ Duplicate transaction detected: ${transactionId}`);
    return ctx.reply("⚠️ This payment was already processed.");
  }

  const userRef = doc(db, "users", userId);

  // 🔒 Атомарная транзакция
  const newWallet = await runTransaction(db, async (transaction) => {
    const userSnap = await transaction.get(userRef);
    
    let currentWallet = 0;
    if (!userSnap.exists()) {
      // Создаём пользователя с начальным балансом
      transaction.set(userRef, {
        username: ctx.from.username || `User-${userId}`,
        wallet: amount,
        createdAt: Date.now(),
        slotTickets: 0,
        slotSpins: 0,
        slotWins: 0,
        slotSpentStars: 0,
        slotEarnedStars: 0,
        pendingPayoutStars: 0,
      });
      currentWallet = amount;
    } else {
      currentWallet = userSnap.data().wallet || 0;
      transaction.update(userRef, { 
        wallet: currentWallet + amount,
        lastWalletUpdate: Date.now()
      });
      currentWallet += amount;
    }

    // 📝 Логируем транзакцию
    transaction.set(transactionRef, {
      type: "topup",
      userId,
      amount,
      timestamp: Date.now(),
      telegramChargeId: payment.telegram_payment_charge_id || null,
      providerChargeId: payment.provider_payment_charge_id || null,
      status: "completed"
    });

    return currentWallet;
  });

  console.log(`✅ Wallet topup for ${userId}: +${amount} ⭐, total = ${newWallet}`);

  await bot.telegram.sendMessage(
    userId,
    `✅ Payment successful!\n💫 Added ${amount} ⭐ to your Wallet.\n💰 Current balance: ${newWallet} ⭐`
  );
}

/**
 * 🎰 Обработка покупки слот-билетов (для бот-игры)
 */
async function handleSlotTicketPurchase(bot, db, payload, userId, chatId, fromUser, PRICE_STARS, TICKETS_PER_PURCHASE) {
  const userRef = doc(db, "users", userId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) {
    // Создаём пользователя
    await setDoc(userRef, {
      username: fromUser.username || `User-${userId}`,
      slotTickets: TICKETS_PER_PURCHASE,
      slotSpentStars: PRICE_STARS,
      slotSpins: 0,
      slotWins: 0,
      slotEarnedStars: 0,
      pendingPayoutStars: 0,
      wallet: 0,
      createdAt: Date.now(),
    });
  } else {
    // Обновляем существующего
    const currentData = userSnap.data();
    await updateDoc(userRef, {
      slotTickets: (currentData.slotTickets || 0) + TICKETS_PER_PURCHASE,
      slotSpentStars: (currentData.slotSpentStars || 0) + PRICE_STARS,
    });
  }

  await bot.telegram.sendMessage(
    chatId,
    `✅ Purchase confirmed!\n🎟️ You received ${TICKETS_PER_PURCHASE} slot ticket(s).\n💰 Spent: ${PRICE_STARS} ⭐`
  );

  console.log(`✅ Slot tickets for ${userId}: +${TICKETS_PER_PURCHASE} tickets`);
}

/**
 * 🎰 Обработка покупки спинов для Mini-App Slot Machine
 * Payload format: slot_purchase_<telegramId>_<timestamp>
 */
async function handleMiniAppSlotPurchase(bot, db, payload, userId, payment, ctx) {
  try {
    // Парсим payload
    const parts = payload.split("_");
    const telegramId = parts[2]; // slot_purchase_<ID>_<timestamp>
    const timestamp = parts[3];
    const amount = payment.total_amount; // Количество звёзд (1 или 20)

    console.log(`🎰 Mini-App Slot purchase: ${telegramId}, amount: ${amount} ⭐`);

    // Определяем количество спинов (3 спина за покупку)
    const SPINS_TO_ADD = 3;

    // 🔒 Защита от дублирования
    const transactionId = `miniapp_slot_${telegramId}_${timestamp}`;
    const transactionRef = doc(db, "transactions", transactionId);
    const transactionSnap = await getDoc(transactionRef);
    
    if (transactionSnap.exists()) {
      console.warn(`⚠️ Duplicate Mini-App slot purchase detected: ${transactionId}`);
      return ctx.reply("⚠️ This purchase was already processed.");
    }

    const userRef = doc(db, "users", telegramId);

    // 🔒 Атомарное обновление через транзакцию
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists()) {
        // Создаём нового пользователя (маловероятно, но на всякий случай)
        transaction.set(userRef, {
          username: ctx.from.username || `User-${telegramId}`,
          slotSpins: SPINS_TO_ADD,
          slotTotalSpins: 0,
          slotWins: 0,
          slotTotalEarned: 0,
          slotJackpots: 0,
          slotBigWins: 0,
          createdAt: Date.now(),
        });
      } else {
        // Обновляем существующего пользователя
        const currentSpins = userSnap.data().slotSpins || 0;
        transaction.update(userRef, {
          slotSpins: currentSpins + SPINS_TO_ADD
        });
      }

      // 📝 Логируем транзакцию покупки
      transaction.set(transactionRef, {
        type: "miniapp_slot_purchase",
        userId: telegramId,
        spinsAdded: SPINS_TO_ADD,
        amountPaid: amount,
        timestamp: Date.now(),
        telegramChargeId: payment.telegram_payment_charge_id || null,
        providerChargeId: payment.provider_payment_charge_id || null,
        status: "completed"
      });
    });

    console.log(`✅ Mini-App Slot purchase completed for ${telegramId}: +${SPINS_TO_ADD} spins`);

    // Отправляем подтверждение пользователю
    await bot.telegram.sendMessage(
      telegramId,
      `✅ Purchase successful!\n🎰 You received ${SPINS_TO_ADD} spins for Slot Machine!\n💰 Spent: ${amount} ⭐\n\n🎮 Return to the Mini-App to play!`
    );

  } catch (error) {
    console.error("❌ Error handling Mini-App slot purchase:", error);
    
    try {
      await ctx.reply(
        "⚠️ Purchase processing error. Please contact support.\n" +
        "💬 @Deviola_programmer"
      );
    } catch {}
  }
}

/**
 * ⚔️ Обработка PvP платежей (если используются Stars напрямую)
 */
async function handlePvpPayment(bot, db, payload, userId, ctx) {
  const [type, battleId, role] = payload.split("_");

  const battle = await getBattleById(db, battleId);
  if (!battle) return;

  const expectedId = role === "initiator" ? battle.initiatorId : battle.opponentId;
  if (userId !== expectedId.toString()) {
    return ctx.reply("⚠️ This invoice is not for you.");
  }

  if (role === "initiator") {
    await updateBattle(db, battleId, { initiatorPaid: true });
  }
  if (role === "opponent") {
    await updateBattle(db, battleId, { opponentPaid: true });
  }

  const updated = await getBattleById(db, battleId);
  if (updated.initiatorPaid && updated.opponentPaid) {
    await updateBattle(db, battleId, { status: "paid_by_both" });
  }

  await ctx.reply("✅ Payment successful! You can return to the battle chat.");
}
