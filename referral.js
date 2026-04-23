// referral.js - Referral System with Unified Data Structure
import { doc, getDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db, getUserData, createUser, incrementUserBalances } from "./firebase.js";

/**
 * Process referral link
 * Called when a new user starts the bot with a referral parameter
 */
export async function processReferral(ctx, referrerId) {
  const telegramId = ctx.from.id.toString();
  const username = ctx.from.username || ctx.from.first_name || `User-${telegramId}`;
  
  try {
    // Check if user already exists
    let userData = await getUserData(telegramId);
    
    // Don't allow self-referral
    if (referrerId === telegramId) {
      console.log(`Self-referral blocked: ${telegramId}`);
      return;
    }
    
    // If user already exists and has invitedBy, ignore referral
    if (userData && userData.invitedBy) {
      console.log(`User ${telegramId} already referred by ${userData.invitedBy}`);
      return;
    }
    
    // Create new user if doesn't exist
    if (!userData) {
      userData = await createUser(telegramId, username);
    }
    
    // Set referrer
    const userRef = doc(db, "users", telegramId);
    await updateDoc(userRef, {
      invitedBy: referrerId
    });
    
    // Add to referrer's list
    const referrerRef = doc(db, "users", referrerId);
    const referrerSnap = await getDoc(referrerRef);
    
    if (!referrerSnap.exists()) {
      console.log(`Referrer ${referrerId} not found`);
      return;
    }
    
    await updateDoc(referrerRef, {
      invitedUsers: arrayUnion(telegramId)
    });
    
    // Award referral bonus using NEW unified structure
    await awardReferralBonus(referrerId, telegramId);
    
    console.log(`✅ Referral processed: ${telegramId} referred by ${referrerId}`);
    
    // Notify user
    await ctx.reply(
      `🎉 Welcome to Minimorph!\n\n` +
      `You were invited by a friend. Both of you will receive rewards!\n\n` +
      `🎁 Bonuses:\n` +
      `• 50 Credits\n` +
      `• 10 Energy\n` +
      `• 5 Morph tokens`
    );
    
    // Notify referrer
    try {
      await ctx.telegram.sendMessage(
        referrerId,
        `🎉 New referral!\n\n` +
        `${username} joined using your link!\n\n` +
        `🎁 Your rewards:\n` +
        `• 100 Credits\n` +
        `• 20 Energy\n` +
        `• 10 Morph tokens`
      );
    } catch (err) {
      console.log(`Could not notify referrer ${referrerId}:`, err.message);
    }
    
  } catch (err) {
    console.error("Process referral error:", err);
  }
}

/**
 * Award referral bonuses using unified data structure
 */
async function awardReferralBonus(referrerId, newUserId) {
  try {
    // Reward for REFERRER (person who invited)
    await incrementUserBalances(referrerId, {
      credits: 100,
      energy: 20,
      morph: 10
    });
    
    // Reward for NEW USER (person who was invited)
    await incrementUserBalances(newUserId, {
      credits: 50,
      energy: 10,
      morph: 5
    });
    
    console.log(`✅ Referral bonuses awarded: ${referrerId} → ${newUserId}`);
    
  } catch (err) {
    console.error("Award referral bonus error:", err);
  }
}

/**
 * Get referral statistics for a user
 */
export async function getReferralStats(telegramId) {
  try {
    const userData = await getUserData(telegramId);
    
    if (!userData) {
      return {
        invitedBy: null,
        totalInvites: 0,
        invitedUsers: []
      };
    }
    
    return {
      invitedBy: userData.invitedBy || null,
      totalInvites: userData.invitedUsers?.length || 0,
      invitedUsers: userData.invitedUsers || []
    };
    
  } catch (err) {
    console.error("Get referral stats error:", err);
    return {
      invitedBy: null,
      totalInvites: 0,
      invitedUsers: []
    };
  }
}

/**
 * Generate referral link
 */
export function generateReferralLink(botUsername, telegramId) {
  return `https://t.me/${botUsername}?start=ref_${telegramId}`;
}

/**
 * Bot command: /referral
 * Shows referral statistics and link
 */
export async function handleReferralCommand(ctx, botUsername) {
  const telegramId = ctx.from.id.toString();
  
  try {
    const stats = await getReferralStats(telegramId);
    const referralLink = generateReferralLink(botUsername, telegramId);
    
    const message = 
      `👥 Your Referral Stats\n\n` +
      `📊 Total invites: ${stats.totalInvites}\n\n` +
      `🎁 Rewards per referral:\n` +
      `You get: 100 Credits, 20 Energy, 10 Morph\n` +
      `They get: 50 Credits, 10 Energy, 5 Morph\n\n` +
      `🔗 Your referral link:\n` +
      `${referralLink}`;
    
    await ctx.reply(message, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "📤 Share Link", url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=Join%20Minimorph!` }]
        ]
      }
    });
    
  } catch (err) {
    console.error("Referral command error:", err);
    await ctx.reply("⚠️ Error fetching referral stats. Please try again.");
  }
}

export default {
  processReferral,
  getReferralStats,
  generateReferralLink,
  handleReferralCommand,
  awardReferralBonus
};
