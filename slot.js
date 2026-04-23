// slot.js - Slot Machine Module for Bot & Mini-App
import express from "express";
import { doc, getDoc, updateDoc, increment } from "firebase/firestore";
import { db, getUserData, createUser } from "./firebase.js";

const router = express.Router();

/**
 * Initialize slot machine module
 * Supports TWO systems:
 * 1. Bot emoji 🎰 → uses slotTickets (bot-only)
 * 2. Mini-App UI → uses slotSpins (shared)
 */
export default function initSlotModule(bot, config) {
  
  const {
    SLOT_PRICE_STARS = 20,
    SLOT_TICKETS_PER_PURCHASE = 3,
    SLOT_JACKPOT_REWARD = 100,
    SLOT_PAIR_REWARD = 8,
    SLOT_NEWBIE_SPINS = 9,
    SLOT_NEWBIE_MULTIPLIER = 1.3
  } = config;
  
  // ========================================
  // BOT: Emoji 🎰 Handler (uses slotTickets)
  // ========================================
  bot.on("message", async (ctx) => {
    if (!ctx.message?.dice || ctx.message.dice.emoji !== "🎰") return;

    const telegramId = ctx.from.id.toString();
    
    try {
      let userData = await getUserData(telegramId);
      
      // Create new user if doesn't exist
      if (!userData) {
        const username = ctx.from.username || ctx.from.first_name || `User-${telegramId}`;
        userData = await createUser(telegramId, username);
        
        // Give newbie spins as slotTickets
        const userRef = doc(db, "users", telegramId);
        await updateDoc(userRef, {
          slotTickets: SLOT_NEWBIE_SPINS
        });
        
        await ctx.reply(
          `🎉 Welcome bonus: ${SLOT_NEWBIE_SPINS} free tickets!\n` +
          `🎰 Your first ${SLOT_NEWBIE_SPINS} wins will be multiplied by ${SLOT_NEWBIE_MULTIPLIER}x!\n\n` +
          `Send the 🎰 emoji again to spin!`
        );
        
        return;
      }

      const tickets = userData.slotTickets || 0;

      if (tickets <= 0) {
        return ctx.reply(
          `❌ You have no tickets left!\n\n` +
          `💰 Buy more for ${SLOT_PRICE_STARS}⭐ (${SLOT_TICKETS_PER_PURCHASE} tickets)\n` +
          `🎰 Or use the Mini-App for more spins!`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: "💳 Buy Tickets", callback_data: "buy_ticket" }]
              ]
            }
          }
        );
      }

      // Get slot result
      const slotValue = ctx.message.dice.value;
      const slotResult = getSlotResult(slotValue);

      // Check if newbie spin
      const totalSpins = userData.slotTotalSpins || 0;
      const isNewbieSpin = totalSpins < SLOT_NEWBIE_SPINS;
      const multiplier = isNewbieSpin ? SLOT_NEWBIE_MULTIPLIER : 1.0;

      let reward = 0;
      let message = "";

      if (slotResult.type === "jackpot") {
        reward = Math.floor(SLOT_JACKPOT_REWARD * multiplier);
        message = `🎰 JACKPOT! 🎰\n💰 You won ${reward}⭐!`;
        
        await updateDoc(doc(db, "users", telegramId), {
          slotJackpots: increment(1)
        });
      } else if (slotResult.type === "pair") {
        reward = Math.floor(SLOT_PAIR_REWARD * multiplier);
        message = `🎉 Pair! You won ${reward}⭐!`;
      } else {
        message = `😔 No luck this time!`;
      }

      // Update statistics (SHARED fields)
      const userRef = doc(db, "users", telegramId);
      await updateDoc(userRef, {
        // Bot-specific
        slotTickets: increment(-1),
        slotEarnedStars: increment(reward),
        
        // SHARED statistics (bot + miniapp)
        slotTotalSpins: increment(1),
        slotWins: reward > 0 ? increment(1) : userData.slotWins || 0,
        slotTotalEarned: increment(reward)
      });

      if (isNewbieSpin) {
        message += `\n✨ Newbie bonus active! (${SLOT_NEWBIE_SPINS - totalSpins - 1} spins left)`;
      }

      message += `\n\n🎟️ Tickets left: ${tickets - 1}`;

      await ctx.reply(message, {
        reply_markup: tickets - 1 === 0 ? {
          inline_keyboard: [
            [{ text: "💳 Buy More Tickets", callback_data: "buy_ticket" }]
          ]
        } : undefined
      });

      if (reward > 0) {
        await ctx.reply(
          `💰 Total winnings: ${(userData.slotEarnedStars || 0) + reward}⭐\n` +
          `💡 Minimum withdrawal: 100⭐`
        );
      }

    } catch (err) {
      console.error("Slot spin error:", err);
      await ctx.reply("⚠️ Error processing spin. Please try again.");
    }
  });

  // ========================================
  // REST API ENDPOINTS
  // ========================================

  /**
   * GET /api/slot/stats/:telegramId
   * Returns slot statistics (shared between bot and miniapp)
   */
  router.get("/stats/:telegramId", async (req, res) => {
    try {
      const { telegramId } = req.params;
      const userData = await getUserData(telegramId);

      if (!userData) {
        return res.json({
          slotSpins: 0,
          slotTickets: 0,
          slotTotalSpins: 0,
          slotWins: 0,
          slotTotalEarned: 0,
          slotJackpots: 0,
          slotBigWins: 0,
          slotEarnedStars: 0
        });
      }

      res.json({
        // Mini-App field
        slotSpins: userData.slotSpins || 0,
        
        // Bot field
        slotTickets: userData.slotTickets || 0,
        
        // SHARED statistics
        slotTotalSpins: userData.slotTotalSpins || 0,
        slotWins: userData.slotWins || 0,
        slotTotalEarned: userData.slotTotalEarned || 0,
        slotJackpots: userData.slotJackpots || 0,
        slotBigWins: userData.slotBigWins || 0,
        
        // Bot-only
        slotEarnedStars: userData.slotEarnedStars || 0
      });
    } catch (err) {
      console.error("Error fetching slot stats:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  /**
   * POST /api/slot/spin
   * Mini-App spin endpoint (uses slotSpins, NOT slotTickets)
   */
  router.post("/spin", async (req, res) => {
    try {
      const { telegramId } = req.body;
      
      const userData = await getUserData(telegramId);
      
      if (!userData) {
        return res.status(404).json({ error: "User not found" });
      }
      
      const spins = userData.slotSpins || 0;
      
      if (spins <= 0) {
        return res.status(400).json({ 
          error: "No spins available",
          slotSpins: 0
        });
      }
      
      // Generate random slot result
      const result = generateMiniAppSlotResult();
      
      // Calculate reward
      let reward = 0;
      let rewardType = "none";
      
      if (result.type === "jackpot") {
        reward = SLOT_JACKPOT_REWARD;
        rewardType = "jackpot";
      } else if (result.type === "bigwin") {
        reward = 50;
        rewardType = "bigwin";
      } else if (result.type === "pair") {
        reward = SLOT_PAIR_REWARD;
        rewardType = "pair";
      }
      
      // Update user data
      const userRef = doc(db, "users", telegramId);
      await updateDoc(userRef, {
        // Consume spin
        slotSpins: increment(-1),
        
        // SHARED statistics
        slotTotalSpins: increment(1),
        slotWins: reward > 0 ? increment(1) : userData.slotWins || 0,
        slotTotalEarned: increment(reward),
        slotJackpots: result.type === "jackpot" ? increment(1) : userData.slotJackpots || 0,
        slotBigWins: result.type === "bigwin" ? increment(1) : userData.slotBigWins || 0
      });
      
      res.json({
        success: true,
        result: result.symbols,
        reward: reward,
        rewardType: rewardType,
        slotSpins: spins - 1,
        slotTotalSpins: (userData.slotTotalSpins || 0) + 1,
        slotTotalEarned: (userData.slotTotalEarned || 0) + reward
      });
      
    } catch (err) {
      console.error("Mini-App spin error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  return router;
}

/**
 * Determine bot slot result from Telegram dice value
 */
function getSlotResult(value) {
  // Telegram values:
  // 1-4 = Jackpot (three of a kind)
  // 22, 43, 64 = Pairs
  
  const jackpots = [1, 2, 3, 4];
  const pairs = [22, 43, 64];

  if (jackpots.includes(value)) {
    return { type: "jackpot", value };
  }
  if (pairs.includes(value)) {
    return { type: "pair", value };
  }
  return { type: "loss", value };
}

/**
 * Generate random slot result for Mini-App
 */
function generateMiniAppSlotResult() {
  const symbols = ["🍒", "🍋", "🍊", "🍇", "⭐", "💎", "7️⃣"];
  
  // Probabilities
  const rand = Math.random();
  
  if (rand < 0.01) {
    // 1% - Jackpot (three matching)
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    return {
      type: "jackpot",
      symbols: [symbol, symbol, symbol]
    };
  } else if (rand < 0.05) {
    // 4% - Big Win (two 7s or diamonds)
    const special = Math.random() < 0.5 ? "7️⃣" : "💎";
    return {
      type: "bigwin",
      symbols: [special, special, symbols[Math.floor(Math.random() * symbols.length)]]
    };
  } else if (rand < 0.15) {
    // 10% - Pair (two matching)
    const symbol = symbols[Math.floor(Math.random() * symbols.length)];
    const third = symbols[Math.floor(Math.random() * symbols.length)];
    return {
      type: "pair",
      symbols: [symbol, symbol, third]
    };
  } else {
    // 85% - No win
    return {
      type: "loss",
      symbols: [
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)],
        symbols[Math.floor(Math.random() * symbols.length)]
      ]
    };
  }
}

export { router as slotRouter };
