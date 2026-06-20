// paymentsHandler.js - Payment Handler for Telegram Stars
import { doc, getDoc, setDoc, updateDoc, increment, addDoc, collection, serverTimestamp } from "firebase/firestore";
// Note: serverTimestamp used in addDoc calls below
import { db } from "./firebase.js";

/**
 * Handle successful payment (pre-checkout query)
 */
export async function handlePreCheckoutQuery(ctx) {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (err) {
    console.error("Pre-checkout error:", err);
    await ctx.answerPreCheckoutQuery(false, "Payment processing error");
  }
}

/**
 * Handle successful payment
 * Routes to different handlers based on payload
 */
export async function handleSuccessfulPayment(ctx, config) {
  try {
    const payment = ctx.message.successful_payment;
    const { payload } = payment;
    const telegramId = ctx.from.id.toString();
    const chargeId = payment.telegram_payment_charge_id;

    console.log(`💰 Payment received from ${telegramId}, payload: ${payload}, charge: ${chargeId}`);

    // ── IDEMPOTENCY GUARD ──────────────────────────────────────────────
    // Защита от двойного начисления при повторной доставке вебхука
    const paymentRef = doc(db, "processed_payments", chargeId);
    const paymentSnap = await getDoc(paymentRef);
    if (paymentSnap.exists()) {
      console.warn(`⚠️ Duplicate payment detected: ${chargeId} — skipping`);
      await ctx.reply("✅ Payment already processed!");
      return;
    }
    // Сразу помечаем как обработанный (до начисления — race condition protection)
    await setDoc(paymentRef, {
      telegramId,
      payload,
      chargeId,
      processedAt: serverTimestamp(),
    });
    // ──────────────────────────────────────────────────────────────────
    
    // Route to different handlers based on payload
    if (payload.startsWith("slot_ticket_")) {
      await handleBotSlotTicketPurchase(ctx, config);
    } else if (payload.startsWith("slot_purchase_")) {
      await handleMiniAppSlotPurchase(ctx, config);
    } else if (payload.startsWith("pvp_")) {
      await handlePvPPayment(ctx, config);
    } else if (payload.startsWith("shop_")) {
      await handleShopPurchase(ctx, payload, telegramId);
    } else {
      console.warn(`Unknown payment payload: ${payload}`);
      await ctx.reply("✅ Payment received, but type unknown. Contact support.");
    }
    
  } catch (err) {
    console.error("Payment handler error:", err);
    await ctx.reply("⚠️ Error processing payment. Please contact support.");
  }
}

/**
 * Handle BOT slot ticket purchase (emoji 🎰)
 * Uses slotTickets field
 */
async function handleBotSlotTicketPurchase(ctx, config) {
  const telegramId = ctx.from.id.toString();
  const userRef = doc(db, "users", telegramId);
  
  const { SLOT_TICKETS_PER_PURCHASE, SLOT_PRICE_STARS } = config;
  
  try {
    // Update user's slotTickets (NOT slotSpins - this is for bot only)
    await updateDoc(userRef, {
      slotTickets: increment(SLOT_TICKETS_PER_PURCHASE),
      slotSpentStars: increment(SLOT_PRICE_STARS)
    });
    
    // Save transaction
    await addDoc(collection(db, "transactions"), {
      type: "bot_slot_ticket_purchase",
      userId: telegramId,
      amount: SLOT_PRICE_STARS,
      ticketsAdded: SLOT_TICKETS_PER_PURCHASE,
      timestamp: serverTimestamp()
    });
    
    await ctx.reply(
      `✅ Purchase successful!\n\n` +
      `🎟️ You received ${SLOT_TICKETS_PER_PURCHASE} tickets\n` +
      `🎰 Send the slot emoji to spin!\n\n` +
      `💡 Tip: Jackpot = 100⭐, Pair = 8⭐`
    );
    
    console.log(`✅ Bot slot tickets purchased: ${telegramId} (+${SLOT_TICKETS_PER_PURCHASE} tickets)`);
    
  } catch (err) {
    console.error("Bot slot ticket purchase error:", err);
    await ctx.reply("⚠️ Error adding tickets. Please contact support.");
  }
}

/**
 * Handle MINI-APP slot spin purchase
 * Uses slotSpins field (shared with Mini-App)
 */
async function handleMiniAppSlotPurchase(ctx, config) {
  const telegramId = ctx.from.id.toString();
  const userRef = doc(db, "users", telegramId);
  
  const { MINIAPP_SPINS_PER_PURCHASE, MINIAPP_SLOT_PRICE } = config;
  
  try {
    // Update user's slotSpins (SHARED with Mini-App)
    await updateDoc(userRef, {
      slotSpins: increment(MINIAPP_SPINS_PER_PURCHASE)
    });
    
    // Save transaction
    await addDoc(collection(db, "transactions"), {
      type: "miniapp_slot_purchase",
      userId: telegramId,
      amount: MINIAPP_SLOT_PRICE,
      spinsAdded: MINIAPP_SPINS_PER_PURCHASE,
      timestamp: serverTimestamp()
    });
    
    await ctx.reply(
      `✅ Slot spins purchased!\n\n` +
      `🎰 You received ${MINIAPP_SPINS_PER_PURCHASE} spins\n` +
      `📱 Open the Mini-App to play!\n\n` +
      `💰 Win credits, morph, and rare prizes!`
    );
    
    console.log(`✅ Mini-App slot spins purchased: ${telegramId} (+${MINIAPP_SPINS_PER_PURCHASE} spins)`);
    
  } catch (err) {
    console.error("Mini-App slot purchase error:", err);
    await ctx.reply("⚠️ Error adding spins. Please contact support.");
  }
}

/**
 * Handle Shop purchase (Telegram Stars shop items)
 * payload format: shop_{itemId}_{timestamp}
 */
async function handleShopPurchase(ctx, payload, telegramId) {
  // Извлекаем itemId из payload: shop_energy_boost_s_1234567890
  // Формат: shop_ + itemId + _ + timestamp
  // itemId может содержать подчёркивания, поэтому отрезаем последний сегмент (timestamp)
  const withoutPrefix = payload.replace(/^shop_/, "");
  const parts = withoutPrefix.split("_");
  // timestamp — последний элемент (число), itemId — всё остальное
  parts.pop(); // убираем timestamp
  const itemId = parts.join("_");

  const SHOP_ITEMS = {
    energy_boost_s: { energyAmount: 30  },
    energy_boost_m: { energyAmount: 100 },
    slot_spins_5:   { spinsAmount: 5    },
    slot_spins_20:  { spinsAmount: 20   },
    morph_pack_s:   { morphAmount: 10   },
    morph_pack_m:   { morphAmount: 30   },
    vip_boost_24h:  { vipHours: 24      },
  };

  const item = SHOP_ITEMS[itemId];
  if (!item) {
    console.warn(`Unknown shop item: ${itemId}`);
    await ctx.reply("✅ Payment received. Contact support if item not applied.");
    return;
  }

  const userRef = doc(db, "users", telegramId);

  try {
    // Формируем atomic update
    const updates = {};
    let replyText = "✅ Purchase successful!\n\n";

    if (item.energyAmount) {
      updates["balances.energy"] = increment(item.energyAmount);
      updates["energy"] = increment(item.energyAmount); // backward compat
      replyText += `⚡ +${item.energyAmount} Energy added\n`;
    }
    if (item.spinsAmount) {
      updates["slotSpins"] = increment(item.spinsAmount);
      replyText += `🎰 +${item.spinsAmount} Slot Spins added\n`;
    }
    if (item.morphAmount) {
      updates["balances.morph"] = increment(item.morphAmount);
      updates["minimaCoins"] = increment(item.morphAmount); // backward compat
      replyText += `💎 +${item.morphAmount} MORPH added\n`;
    }
    if (item.vipHours) {
      const expiry = Date.now() + item.vipHours * 60 * 60 * 1000;
      updates["vipBoostExpiry"] = expiry;
      replyText += `👑 VIP Boost active for ${item.vipHours}h\n`;
      replyText += `   All rewards ×1.5 until ${new Date(expiry).toUTCString()}\n`;
    }

    await updateDoc(userRef, updates);

    // Логируем транзакцию
    await addDoc(collection(db, "transactions"), {
      type: "shop_purchase",
      userId: telegramId,
      itemId,
      item,
      timestamp: serverTimestamp(),
    });

    replyText += "\n📱 Open Minimorph to see your balance!";
    await ctx.reply(replyText);

    console.log(`✅ Shop purchase: ${telegramId} bought ${itemId}`);
  } catch (err) {
    console.error("Shop purchase handler error:", err);
    await ctx.reply("⚠️ Error applying purchase. Please contact support.");
  }
}

/**
 * Handle PvP battle payment
 */
async function handlePvPPayment(ctx, config) {
  const telegramId = ctx.from.id.toString();
  
  try {
    await ctx.reply(
      `✅ PvP entry fee received!\n\n` +
      `⚔️ Your battle will start soon.\n` +
      `Check your status in the Mini-App.`
    );
    
    console.log(`✅ PvP payment received: ${telegramId}`);
    
  } catch (err) {
    console.error("PvP payment error:", err);
  }
}

/**
 * Create slot ticket invoice for BOT (emoji 🎰)
 */
export async function createBotSlotTicketInvoice(ctx, config) {
  const { SLOT_PRICE_STARS, SLOT_TICKETS_PER_PURCHASE } = config;
  
  const payload = `slot_ticket_${Date.now()}`;
  
  try {
    await ctx.replyWithInvoice({
      title: "🎰 Slot Machine Tickets",
      description: `Get ${SLOT_TICKETS_PER_PURCHASE} tickets to play the slot machine with the 🎰 emoji`,
      payload: payload,
      currency: "XTR",
      prices: [
        { label: "Slot Tickets", amount: SLOT_PRICE_STARS }
      ]
    });
  } catch (err) {
    console.error("Create invoice error:", err);
    await ctx.reply("⚠️ Error creating invoice. Please try again.");
  }
}

/**
 * Create slot spins invoice for MINI-APP
 * Called from REST API endpoint
 */
export async function createMiniAppSlotInvoice(bot, telegramId, config) {
  const { MINIAPP_SLOT_PRICE, MINIAPP_SPINS_PER_PURCHASE } = config;
  
  const payload = `slot_purchase_${Date.now()}`;
  
  try {
    await bot.telegram.sendInvoice(
      telegramId,
      "🎰 Slot Machine Spins",
      `Get ${MINIAPP_SPINS_PER_PURCHASE} spins for the Slot Machine in the Mini-App`,
      payload,
      process.env.PAYMENT_PROVIDER_TOKEN || "",
      "XTR",
      [{ label: "Spins", amount: MINIAPP_SLOT_PRICE }]
    );
    
    return { success: true };
  } catch (err) {
    console.error("Create Mini-App invoice error:", err);
    throw err;
  }
}
