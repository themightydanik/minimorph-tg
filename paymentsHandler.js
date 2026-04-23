// paymentsHandler.js - Payment Handler for Telegram Stars
import { doc, updateDoc, increment, addDoc, collection, serverTimestamp } from "firebase/firestore";
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
    const { payload } = ctx.message.successful_payment;
    const telegramId = ctx.from.id.toString();
    
    console.log(`💰 Payment received from ${telegramId}, payload: ${payload}`);
    
    // Route to different handlers based on payload
    if (payload.startsWith("slot_ticket_")) {
      await handleBotSlotTicketPurchase(ctx, config);
    } else if (payload.startsWith("slot_purchase_")) {
      await handleMiniAppSlotPurchase(ctx, config);
    } else if (payload.startsWith("pvp_")) {
      await handlePvPPayment(ctx, config);
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
