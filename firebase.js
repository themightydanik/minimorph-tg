// firebase.js - Firebase Configuration & Helper Functions
import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc, updateDoc, increment, serverTimestamp } from "firebase/firestore";

// Firebase configuration
  const firebaseConfig = {
    apiKey: "AIzaSyDJcoFIMzVKy0YFlwfeZPmuYwwyS8VqJAA",
    authDomain: "minimorph-b52f7.firebaseapp.com",
    projectId: "minimorph-b52f7",
    storageBucket: "minimorph-b52f7.firebasestorage.app",
    messagingSenderId: "346164042237",
    appId: "1:346164042237:web:fcff2f4e6af39baf9a2194",
    measurementId: "G-0TFC304JVN"
  };

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ========================================
// HELPER FUNCTIONS FOR UNIFIED DATA STRUCTURE
// ========================================

/**
 * Get user balances with fallback to old structure
 * Supports BOTH old (points, minimaCoins) and new (balances.*) structures
 */
export const getUserBalances = async (telegramId) => {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  
  if (!snap.exists()) {
    return {
      credits: 0,
      energy: 60,
      morph: 0
    };
  }
  
  const data = snap.data();
  
  // Try new structure first, fallback to old
  return {
    credits: data.balances?.credits ?? data.points ?? 0,
    energy: data.balances?.energy ?? data.energy ?? 60,
    morph: data.balances?.morph ?? data.minimaCoins ?? 0
  };
};

/**
 * Get colony data with fallback to old structure
 * Supports BOTH old (tps) and new (colony.population) structures
 */
export const getColonyData = async (telegramId) => {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  
  if (!snap.exists()) {
    return {
      level: 1,
      population: 0,
      income: 0,
      lastCollected: Date.now(),
      buildings: {}
    };
  }
  
  const data = snap.data();
  
  // Try new structure first, fallback to old
  return {
    level: data.colony?.level ?? 1,
    population: data.colony?.population ?? data.tps ?? 0,
    income: data.colony?.income ?? 0,
    lastCollected: data.colony?.lastCollected ?? Date.now(),
    buildings: data.colony?.buildings ?? {}
  };
};

/**
 * Update user balances - writes to BOTH structures for compatibility
 */
export const updateUserBalances = async (telegramId, updates) => {
  const userRef = doc(db, "users", telegramId);
  
  const updateData = {};
  
  if (updates.credits !== undefined) {
    updateData['balances.credits'] = updates.credits;
    updateData['points'] = updates.credits; // Backward compatibility
  }
  
  if (updates.energy !== undefined) {
    updateData['balances.energy'] = updates.energy;
    updateData['energy'] = updates.energy; // Backward compatibility
  }
  
  if (updates.morph !== undefined) {
    updateData['balances.morph'] = updates.morph;
    updateData['minimaCoins'] = updates.morph; // Backward compatibility
  }
  
  await updateDoc(userRef, updateData);
};

/**
 * Increment user balances - writes to BOTH structures
 */
export const incrementUserBalances = async (telegramId, increments) => {
  const userRef = doc(db, "users", telegramId);
  
  const updateData = {};
  
  if (increments.credits !== undefined) {
    updateData['balances.credits'] = increment(increments.credits);
    updateData['points'] = increment(increments.credits);
  }
  
  if (increments.energy !== undefined) {
    updateData['balances.energy'] = increment(increments.energy);
    updateData['energy'] = increment(increments.energy);
  }
  
  if (increments.morph !== undefined) {
    updateData['balances.morph'] = increment(increments.morph);
    updateData['minimaCoins'] = increment(increments.morph);
  }
  
  await updateDoc(userRef, updateData);
};

/**
 * Update colony data - writes to BOTH structures
 */
export const updateColonyData = async (telegramId, updates) => {
  const userRef = doc(db, "users", telegramId);
  
  const updateData = {};
  
  if (updates.level !== undefined) {
    updateData['colony.level'] = updates.level;
  }
  
  if (updates.population !== undefined) {
    updateData['colony.population'] = updates.population;
    updateData['tps'] = updates.population; // Backward compatibility
  }
  
  if (updates.income !== undefined) {
    updateData['colony.income'] = updates.income;
  }
  
  if (updates.lastCollected !== undefined) {
    updateData['colony.lastCollected'] = updates.lastCollected;
  }
  
  if (updates.buildings !== undefined) {
    updateData['colony.buildings'] = updates.buildings;
  }
  
  await updateDoc(userRef, updateData);
};

/**
 * Get full user data with unified structure
 */
export const getUserData = async (telegramId) => {
  const userRef = doc(db, "users", telegramId);
  const snap = await getDoc(userRef);
  
  if (!snap.exists()) {
    return null;
  }
  
  const data = snap.data();
  
  return {
    // Balances (unified)
    balances: {
      credits: data.balances?.credits ?? data.points ?? 0,
      energy: data.balances?.energy ?? data.energy ?? 60,
      morph: data.balances?.morph ?? data.minimaCoins ?? 0
    },
    
    // Colony (unified)
    colony: {
      level: data.colony?.level ?? 1,
      population: data.colony?.population ?? data.tps ?? 0,
      income: data.colony?.income ?? 0,
      lastCollected: data.colony?.lastCollected ?? Date.now(),
      buildings: data.colony?.buildings ?? {}
    },
    
    // Slot machine data (shared between bot and miniapp)
    slotSpins: data.slotSpins || 0,
    slotTotalSpins: data.slotTotalSpins || 0,
    slotWins: data.slotWins || 0,
    slotTotalEarned: data.slotTotalEarned || 0,
    slotJackpots: data.slotJackpots || 0,
    slotBigWins: data.slotBigWins || 0,
    
    // Bot-only slot data
    slotTickets: data.slotTickets || 0,
    slotEarnedStars: data.slotEarnedStars || 0,
    
    // Missions
    missions: data.missions || { stats: {} },
    
    // Season
    season: data.season || { points: 0, seasonNumber: 1, rank: null },

    // VIP Boost
    vipBoostExpiry: data.vipBoostExpiry || null,

    // Daily Streak
    currentStreak: data.currentStreak || 0,
    lastStreakDate: data.lastStreakDate || null,
    maxStreak: data.maxStreak || 0,

    // Referral
    invitedBy: data.invitedBy || null,
    invitedUsers: data.invitedUsers || [],
    earned: data.earned || {},

    // Skin / level
    skin: data.skin || 'default',
    level: data.level || 1,

    // Metadata
    username: data.username || '',
    createdAt: data.createdAt || Date.now(),
    lastActive: data.lastActive || Date.now()
  };
};

/**
 * Create new user with unified structure
 */
export const createUser = async (telegramId, username) => {
  const userRef = doc(db, "users", telegramId);
  
  const userData = {
    // New structure
    balances: {
      credits: 0,
      energy: 60,
      morph: 0
    },
    colony: {
      level: 1,
      population: 0,
      income: 0,
      lastCollected: Date.now(),
      buildings: {}
    },
    missions: {
      stats: {
        totalRuns: 0,
        bestScore: 0,
        totalMorphEarned: 0
      }
    },
    
    // Old structure (backward compatibility)
    points: 0,
    energy: 60,
    minimaCoins: 0,
    tps: 0,
    
    // Slot machine
    slotSpins: 0,
    slotTotalSpins: 0,
    slotWins: 0,
    slotTotalEarned: 0,
    slotJackpots: 0,
    slotBigWins: 0,
    slotTickets: 0,
    slotEarnedStars: 0,
    
    // Season Points
    season: {
      points: 0,
      seasonNumber: 1,
      rank: null,
    },

    // VIP Boost
    vipBoostExpiry: null,

    // Daily Streak
    currentStreak: 0,
    lastStreakDate: null,
    maxStreak: 0,

    // Tasks
    completedTasks: {},
    claimedSocialCredits: 0,

    // Referral
    invitedBy: null,
    invitedUsers: [],
    earned: {},
    masterRewards: 0,

    // Stars / wallet
    telegramStars: 0,
    wallet: null,
    pendingPayoutStars: 0,

    // Skin
    skin: 'default',
    level: 1,
    tickets: 7,

    // Metadata
    username: username || `User-${telegramId}`,
    createdAt: Date.now(),
    lastActive: Date.now()
  };
  
  await setDoc(userRef, userData);
  return userData;
};

/**
 * Update user's last active timestamp
 */
export const updateLastActive = async (telegramId) => {
  const userRef = doc(db, "users", telegramId);
  await updateDoc(userRef, {
    lastActive: Date.now()
  });
};

export { db };
