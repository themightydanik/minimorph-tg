// apiRoutes.js - REST API Routes for Mini-App
import express from "express";
import { doc, getDoc, updateDoc, increment } from "firebase/firestore";
import { db, getUserData, getUserBalances, updateUserBalances, getColonyData, updateColonyData } from "./firebase.js";

const router = express.Router();

/**
 * GET /api/user/:telegramId
 * Get full user data with unified structure
 */
router.get("/user/:telegramId", async (req, res) => {
  try {
    const { telegramId } = req.params;
    const userData = await getUserData(telegramId);

    if (!userData) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      // Balances (unified structure)
      balances: userData.balances,
      
      // Colony (unified structure)
      colony: userData.colony,
      
      // Missions
      missions: userData.missions,
      
      // Slot machine (shared)
      slotSpins: userData.slotSpins,
      slotTotalSpins: userData.slotTotalSpins,
      slotWins: userData.slotWins,
      slotTotalEarned: userData.slotTotalEarned,
      slotJackpots: userData.slotJackpots,
      slotBigWins: userData.slotBigWins,
      
      // Referral
      invitedBy: userData.invitedBy,
      invitedUsers: userData.invitedUsers,
      
      // Metadata
      username: userData.username,
      createdAt: userData.createdAt,
      lastActive: userData.lastActive
    });
  } catch (err) {
    console.error("Get user error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/balances/:telegramId
 * Get user balances only
 */
router.get("/balances/:telegramId", async (req, res) => {
  try {
    const { telegramId } = req.params;
    const balances = await getUserBalances(telegramId);
    
    res.json(balances);
  } catch (err) {
    console.error("Get balances error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/balances/update
 * Update user balances
 */
router.post("/balances/update", async (req, res) => {
  try {
    const { telegramId, credits, energy, morph } = req.body;
    
    const updates = {};
    if (credits !== undefined) updates.credits = credits;
    if (energy !== undefined) updates.energy = energy;
    if (morph !== undefined) updates.morph = morph;
    
    await updateUserBalances(telegramId, updates);
    
    const updatedBalances = await getUserBalances(telegramId);
    res.json(updatedBalances);
  } catch (err) {
    console.error("Update balances error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/colony/:telegramId
 * Get colony data
 */
router.get("/colony/:telegramId", async (req, res) => {
  try {
    const { telegramId } = req.params;
    const colonyData = await getColonyData(telegramId);
    
    res.json(colonyData);
  } catch (err) {
    console.error("Get colony error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/colony/upgrade
 * Upgrade a building in the colony
 */
router.post("/colony/upgrade", async (req, res) => {
  try {
    const { telegramId, buildingId, buildingData } = req.body;
    
    if (!telegramId || !buildingId || !buildingData) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    
    // Get current colony data
    const colonyData = await getColonyData(telegramId);
    const balances = await getUserBalances(telegramId);
    
    // Check if user has enough credits
    const cost = buildingData.cost || 0;
    if (balances.credits < cost) {
      return res.status(400).json({ 
        error: "Insufficient credits",
        required: cost,
        current: balances.credits
      });
    }
    
    // Update buildings
    const updatedBuildings = {
      ...colonyData.buildings,
      [buildingId]: buildingData
    };
    
    // Calculate new total population and income
    let totalPopulation = 0;
    let totalIncome = 0;
    
    Object.values(updatedBuildings).forEach(building => {
      totalPopulation += building.population || 0;
      totalIncome += building.income || 0;
    });
    
    // Update colony
    await updateColonyData(telegramId, {
      buildings: updatedBuildings,
      population: totalPopulation,
      income: totalIncome
    });
    
    // Deduct cost from credits
    await updateUserBalances(telegramId, {
      credits: balances.credits - cost
    });
    
    res.json({
      success: true,
      colony: {
        ...colonyData,
        buildings: updatedBuildings,
        population: totalPopulation,
        income: totalIncome
      },
      balances: {
        ...balances,
        credits: balances.credits - cost
      }
    });
    
  } catch (err) {
    console.error("Colony upgrade error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/colony/collect
 * Collect accumulated income
 */
router.post("/colony/collect", async (req, res) => {
  try {
    const { telegramId } = req.body;
    
    const colonyData = await getColonyData(telegramId);
    const balances = await getUserBalances(telegramId);
    
    const now = Date.now();
    const lastCollected = colonyData.lastCollected || now;
    const hoursPassed = Math.min((now - lastCollected) / (1000 * 60 * 60), 8); // Max 8 hours
    
    const income = colonyData.income || 0;
    const collected = Math.floor(income * hoursPassed);
    
    // Update balances
    await updateUserBalances(telegramId, {
      credits: balances.credits + collected
    });
    
    // Update lastCollected
    await updateColonyData(telegramId, {
      lastCollected: now
    });
    
    res.json({
      success: true,
      collected: collected,
      balances: {
        ...balances,
        credits: balances.credits + collected
      },
      colony: {
        ...colonyData,
        lastCollected: now
      }
    });
    
  } catch (err) {
    console.error("Colony collect error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/mission/start
 * Start a mission
 */
router.post("/mission/start", async (req, res) => {
  try {
    const { telegramId, missionType, energyCost } = req.body;
    
    const balances = await getUserBalances(telegramId);
    
    if (balances.energy < energyCost) {
      return res.status(400).json({
        error: "Insufficient energy",
        required: energyCost,
        current: balances.energy
      });
    }
    
    // Deduct energy
    await updateUserBalances(telegramId, {
      energy: balances.energy - energyCost
    });
    
    res.json({
      success: true,
      balances: {
        ...balances,
        energy: balances.energy - energyCost
      }
    });
    
  } catch (err) {
    console.error("Mission start error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/mission/complete
 * Complete a mission and award rewards
 */
router.post("/mission/complete", async (req, res) => {
  try {
    const { telegramId, missionType, score, creditsReward, morphReward } = req.body;
    
    const balances = await getUserBalances(telegramId);
    const userData = await getUserData(telegramId);
    
    // Update balances
    await updateUserBalances(telegramId, {
      credits: balances.credits + (creditsReward || 0),
      morph: balances.morph + (morphReward || 0)
    });
    
    // Update mission stats
    const userRef = doc(db, "users", telegramId);
    const currentStats = userData.missions?.stats || {};
    
    await updateDoc(userRef, {
      'missions.stats.totalRuns': (currentStats.totalRuns || 0) + 1,
      'missions.stats.bestScore': Math.max(currentStats.bestScore || 0, score || 0),
      'missions.stats.totalMorphEarned': (currentStats.totalMorphEarned || 0) + (morphReward || 0)
    });
    
    res.json({
      success: true,
      balances: {
        ...balances,
        credits: balances.credits + (creditsReward || 0),
        morph: balances.morph + (morphReward || 0)
      },
      missions: {
        stats: {
          totalRuns: (currentStats.totalRuns || 0) + 1,
          bestScore: Math.max(currentStats.bestScore || 0, score || 0),
          totalMorphEarned: (currentStats.totalMorphEarned || 0) + (morphReward || 0)
        }
      }
    });
    
  } catch (err) {
    console.error("Mission complete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
