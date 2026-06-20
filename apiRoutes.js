// apiRoutes.js - REST API Routes for Mini-App
import express from "express";
import { doc, getDoc, updateDoc, increment, addDoc, collection, arrayUnion } from "firebase/firestore";
import { db, getUserData, getUserBalances, updateUserBalances, getColonyData, updateColonyData } from "./firebase.js";

// ECONOMY конфиг (синхронизирован с фронтендом)
const SEASON = {
  NUMBER: 1,
  SP_PER_MISSION_SCORE_100: 1,   // 1 SP за каждые 100 очков
  SP_PER_BUILDING_UPGRADE: 10,   // × уровень здания
  SP_PER_REFERRAL: 20,
  SP_PER_1000_POPULATION: 5,
  SP_PER_STREAK_DAY7: 50,
};

const SHOP_ITEMS = {
  energy_boost_s: { stars: 25,  energyAmount: 30  },
  energy_boost_m: { stars: 50,  energyAmount: 100 },
  slot_spins_5:   { stars: 30,  spinsAmount: 5    },
  slot_spins_20:  { stars: 100, spinsAmount: 20   },
  morph_pack_s:   { stars: 75,  morphAmount: 10   },
  morph_pack_m:   { stars: 200, morphAmount: 30   },
  vip_boost_24h:  { stars: 150, vipHours: 24      },
};

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
 * Upgrade a building in the colony.
 * Валидирует кредиты на сервере, обновляет атомарно через incrementUserBalances.
 *
 * Body: { telegramId, buildingId, buildingData: { level, population, income } }
 */
router.post("/colony/upgrade", async (req, res) => {
  try {
    const { telegramId, buildingId, buildingData } = req.body;
    
    if (!telegramId || !buildingId || !buildingData) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Получаем актуальные данные с сервера (не доверяем клиенту)
    const colonyData = await getColonyData(telegramId);
    const balances = await getUserBalances(telegramId);

    // ── Конфигурация зданий (дублирует Colony.jsx — единственный источник стоимостей) ──
    const BUILDING_LEVELS = {
      mine:         [{ cost:500 },{ cost:1500 },{ cost:4000 },{ cost:10000 },{ cost:25000 }],
      lab:          [{ cost:1000 },{ cost:3000 },{ cost:8000 },{ cost:20000 },{ cost:50000 }],
      habitat:      [{ cost:800 },{ cost:2000 },{ cost:5000 },{ cost:12000 },{ cost:30000 }],
      spaceport:    [{ cost:5000 },{ cost:15000 },{ cost:40000 },{ cost:100000 }],
      core:         [{ cost:0 },{ cost:3000 },{ cost:10000 },{ cost:30000 },{ cost:80000 }],
      trading_post: [{ cost:10000 },{ cost:25000 },{ cost:60000 }],
    };

    const buildingLevels = BUILDING_LEVELS[buildingId];
    if (!buildingLevels) {
      return res.status(400).json({ error: "Unknown building" });
    }

    const currentLevel = colonyData.buildings[buildingId]?.level || 0;
    const nextLevelIndex = currentLevel; // 0-based index в массиве

    if (nextLevelIndex >= buildingLevels.length) {
      return res.status(400).json({ error: "Building already at max level" });
    }

    // Серверная проверка стоимости (не доверяем клиенту!)
    const cost = buildingLevels[nextLevelIndex].cost;

    if (balances.credits < cost) {
      return res.status(400).json({ 
        error: "Insufficient credits",
        required: cost,
        current: balances.credits,
      });
    }

    // Season Points за апгрейд здания
    const spForUpgrade = (currentLevel + 1) * SEASON.SP_PER_BUILDING_UPGRADE;

    // Обновляем здание
    const newLevel = currentLevel + 1;
    const updatedBuildings = {
      ...colonyData.buildings,
      [buildingId]: {
        level: newLevel,
        population: buildingData.population || 0,
        income: buildingData.income || 0,
      },
    };

    // Пересчитываем суммарные population и income по всем зданиям
    let totalPopulation = 0;
    let totalIncome = 0;
    Object.values(updatedBuildings).forEach((b) => {
      totalPopulation += b.population || 0;
      totalIncome += b.income || 0;
    });

    // Атомарно обновляем colony
    await updateColonyData(telegramId, {
      buildings: updatedBuildings,
      population: totalPopulation,
      income: totalIncome,
    });

    // Атомарно списываем кредиты (double-write через updateUserBalances)
    await updateUserBalances(telegramId, {
      credits: balances.credits - cost,
    });

    // Начисляем Season Points за апгрейд
    const userRef2 = doc(db, "users", telegramId);
    await updateDoc(userRef2, {
      'season.points': increment(spForUpgrade),
      'season.seasonNumber': SEASON.NUMBER,
    });
    
    const updatedBalances = await getUserBalances(telegramId);

    res.json({
      success: true,
      colony: {
        ...colonyData,
        buildings: updatedBuildings,
        population: totalPopulation,
        income: totalIncome,
      },
      balances: updatedBalances,
      seasonPointsEarned: spForUpgrade,
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
    
    // Update mission stats + Season Points
    const userRef = doc(db, "users", telegramId);
    const currentStats = userData.missions?.stats || {};
    const spEarned = Math.floor((score || 0) / 100) * SEASON.SP_PER_MISSION_SCORE_100;

    await updateDoc(userRef, {
      'missions.stats.totalRuns': (currentStats.totalRuns || 0) + 1,
      'missions.stats.bestScore': Math.max(currentStats.bestScore || 0, score || 0),
      'missions.stats.totalMorphEarned': (currentStats.totalMorphEarned || 0) + (morphReward || 0),
      // Season Points
      'season.points': increment(spEarned),
      'season.seasonNumber': SEASON.NUMBER,
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
      },
      seasonPointsEarned: spEarned,
    });
    
  } catch (err) {
    console.error("Mission complete error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/referral/process
 * Обрабатывает реферал при первом заходе нового пользователя через Mini-App.
 * Idempotent: повторный вызов не начисляет награду дважды.
 */
router.post("/referral/process", async (req, res) => {
  try {
    const { telegramId, referrerId } = req.body;

    if (!telegramId || !referrerId) {
      return res.status(400).json({ error: "Missing telegramId or referrerId" });
    }

    // Блокируем самореферал
    if (telegramId === referrerId) {
      return res.json({ success: false, reason: "self_referral" });
    }

    // Проверяем нового пользователя
    const userRef = doc(db, "users", telegramId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userSnap.data();

    // Idempotency: если реферал уже обработан — не начисляем снова
    if (userData.invitedBy) {
      return res.json({ success: false, reason: "already_referred" });
    }

    // Проверяем реферера
    const referrerRef = doc(db, "users", referrerId);
    const referrerSnap = await getDoc(referrerRef);
    if (!referrerSnap.exists()) {
      return res.json({ success: false, reason: "referrer_not_found" });
    }

    const referrerData = referrerSnap.data();

    // Дополнительная проверка: не начислено ли уже (через earned map или invitedUsers)
    const alreadyInEarned = referrerData.earned?.[telegramId] !== undefined;
    const alreadyInInvited = (referrerData.invitedUsers || []).includes(telegramId);
    if (alreadyInEarned || alreadyInInvited) {
      return res.json({ success: false, reason: "already_processed" });
    }

    // Награды (синхронизированы с ECONOMY в economy.js на фронтенде)
    const INVITER = { credits: 100, energy: 20, morph: 10 };
    const INVITEE = { credits: 50,  energy: 10, morph: 5  };

    // Обновляем нового пользователя: записываем реферера + начисляем бонус (double-write)
    await updateDoc(userRef, {
      invitedBy: referrerId,
      "balances.credits": increment(INVITEE.credits),
      "balances.energy":  increment(INVITEE.energy),
      "balances.morph":   increment(INVITEE.morph),
      points:      increment(INVITEE.credits), // backward compat
      energy:      increment(INVITEE.energy),  // backward compat
      minimaCoins: increment(INVITEE.morph),   // backward compat
    });

    // Обновляем реферера: начисляем бонус + добавляем в списки (double-write)
    const newEarned = { ...(referrerData.earned || {}), [telegramId]: INVITER.credits };
    await updateDoc(referrerRef, {
      "balances.credits": increment(INVITER.credits),
      "balances.energy":  increment(INVITER.energy),
      "balances.morph":   increment(INVITER.morph),
      points:      increment(INVITER.credits), // backward compat
      energy:      increment(INVITER.energy),  // backward compat
      minimaCoins: increment(INVITER.morph),   // backward compat
      invitedUsers: arrayUnion(telegramId),    // новая структура
      earned: newEarned,                       // старая структура
      masterRewards: increment(INVITER.credits),
      // Season Points за реферала
      'season.points': increment(SEASON.SP_PER_REFERRAL),
      'season.seasonNumber': SEASON.NUMBER,
    });

    // Логируем транзакцию для аудита
    await addDoc(collection(db, "referral_transactions"), {
      type: "referral_bonus",
      newUserId: telegramId,
      referrerId,
      inviterBonus: INVITER,
      inviteeBonus: INVITEE,
      processedAt: new Date().toISOString(),
    });

    console.log(`✅ Referral processed: ${telegramId} <- ${referrerId}`);

    res.json({
      success: true,
      inviterBonus: INVITER,
      inviteeBonus: INVITEE,
    });

  } catch (err) {
    console.error("Referral process error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * GET /api/leaderboard
 * Топ-50 игроков по season.points
 */
router.get("/leaderboard", async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const { getDocs, collection: col, query, orderBy, limit: fsLimit } = await import("firebase/firestore");
    const q = query(
      col(db, "users"),
      orderBy("season.points", "desc"),
      fsLimit(limit)
    );
    const snapshot = await getDocs(q);
    const players = [];
    snapshot.forEach((d, i) => {
      const data = d.data();
      players.push({
        rank: players.length + 1,
        telegramId: d.id,
        username: data.username || `User-${d.id.slice(-4)}`,
        seasonPoints: data.season?.points || 0,
        level: data.level || 1,
        population: data.colony?.population || 0,
      });
    });
    res.json({ players });
  } catch (err) {
    console.error("Leaderboard error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * POST /api/shop/invoice
 * Создаёт Telegram Stars инвойс для покупки товара из магазина.
 * Бот отправляет инвойс пользователю через Telegram Bot API.
 */
router.post("/shop/invoice", async (req, res) => {
  try {
    const { telegramId, itemId } = req.body;
    if (!telegramId || !itemId) {
      return res.status(400).json({ error: "Missing telegramId or itemId" });
    }

    const item = SHOP_ITEMS[itemId];
    if (!item) {
      return res.status(400).json({ error: "Unknown item" });
    }

    // Получаем bot из глобального контекста (устанавливается в index.js)
    const bot = req.app.get("bot");
    if (!bot) {
      return res.status(500).json({ error: "Bot not initialized" });
    }

    const payload = `shop_${itemId}_${Date.now()}`;
    const ITEM_LABELS = {
      energy_boost_s: "Energy Boost S — +30 Energy",
      energy_boost_m: "Energy Boost M — Full Energy Restore",
      slot_spins_5:   "5 Slot Spins",
      slot_spins_20:  "20 Slot Spins",
      morph_pack_s:   "MORPH Pack S — +10 MORPH",
      morph_pack_m:   "MORPH Pack M — +30 MORPH",
      vip_boost_24h:  "VIP Boost 24h — All Rewards ×1.5",
    };

    // Создаём инвойс и отправляем пользователю через бота
    const invoiceResult = await bot.telegram.sendInvoice(
      telegramId,
      ITEM_LABELS[itemId] || itemId,
      `Purchase ${ITEM_LABELS[itemId] || itemId} in Minimorph`,
      payload,
      "", // provider_token пустой для Stars
      "XTR",
      [{ label: ITEM_LABELS[itemId] || itemId, amount: item.stars }]
    );

    // Возвращаем ссылку на инвойс через tg:// deep link
    // WebApp.openInvoice принимает invoice link вида https://t.me/$invoiceSlug
    res.json({
      success: true,
      invoiceLink: `https://t.me/$${invoiceResult.invoice?.start_parameter || payload}`,
      payload,
      stars: item.stars,
    });

  } catch (err) {
    console.error("Shop invoice error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

export default router;
