// pvp/pvpFirebase.js - Firebase operations for PvP battles
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from "firebase/firestore";

/**
 * Создаёт новый батл
 */
export async function createBattle(db, initiator, prizePool) {
  const battleId = `battle_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const battleRef = doc(db, "battles", battleId);

  const battleData = {
    id: battleId,
    initiatorId: initiator.id,
    initiatorUsername: initiator.username || initiator.first_name,
    opponentId: null,
    opponentUsername: null,
    prizePool,
    status: "waiting_for_opponent", // waiting_for_opponent, paid_by_both, in_progress, completed
    initiatorPaid: prizePool === 0,
    opponentPaid: prizePool === 0,
    initiatorReady: false,
    opponentReady: false,
    initiatorChoice: null,
    opponentChoice: null,
    winnerId: null,
    createdAt: Date.now(),
    chatId: null,
  };

  await setDoc(battleRef, battleData);
  return battleData;
}

/**
 * Получает батл по ID
 */
export async function getBattleById(db, battleId) {
  const battleRef = doc(db, "battles", battleId);
  const battleSnap = await getDoc(battleRef);

  if (!battleSnap.exists()) {
    return null;
  }

  return battleSnap.data();
}

/**
 * Обновляет данные батла
 */
export async function updateBattle(db, battleId, updates) {
  const battleRef = doc(db, "battles", battleId);
  await updateDoc(battleRef, updates);
}

/**
 * Получает активные батлы (ожидающие противника)
 */
export async function getActiveBattles(db) {
  const battlesRef = collection(db, "battles");
  const q = query(
    battlesRef,
    where("status", "==", "waiting_for_opponent")
  );

  const snapshot = await getDocs(q);
  return snapshot.docs.map(doc => doc.data());
}

/**
 * Получает батлы пользователя
 */
export async function getUserBattles(db, userId) {
  const battlesRef = collection(db, "battles");
  
  // Батлы где пользователь - инициатор
  const q1 = query(
    battlesRef,
    where("initiatorId", "==", userId)
  );
  
  // Батлы где пользователь - оппонент
  const q2 = query(
    battlesRef,
    where("opponentId", "==", userId)
  );

  const [snapshot1, snapshot2] = await Promise.all([
    getDocs(q1),
    getDocs(q2)
  ]);

  const battles = [
    ...snapshot1.docs.map(doc => doc.data()),
    ...snapshot2.docs.map(doc => doc.data())
  ];

  return battles.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Завершает батл с определением победителя
 */
export async function completeBattle(db, battleId, winnerId) {
  const battle = await getBattleById(db, battleId);
  
  if (!battle) {
    throw new Error("Battle not found");
  }

  await updateBattle(db, battleId, {
    status: "completed",
    winnerId,
    completedAt: Date.now()
  });

  // Если есть приз - начисляем победителю
  if (battle.prizePool > 0 && winnerId) {
    const winnerRef = doc(db, "users", winnerId.toString());
    const winnerSnap = await getDoc(winnerRef);
    
    if (winnerSnap.exists()) {
      const currentWallet = winnerSnap.data().wallet || 0;
      await updateDoc(winnerRef, {
        wallet: currentWallet + battle.prizePool
      });
    }
  }

  return battle;
}

/**
 * Отменяет батл и возвращает ставки
 */
export async function cancelBattle(db, battleId) {
  const battle = await getBattleById(db, battleId);
  
  if (!battle) {
    throw new Error("Battle not found");
  }

  const refundAmount = battle.prizePool / 2;

  // Возвращаем ставку инициатору если он заплатил
  if (battle.initiatorPaid && refundAmount > 0) {
    const initiatorRef = doc(db, "users", battle.initiatorId.toString());
    const initiatorSnap = await getDoc(initiatorRef);
    
    if (initiatorSnap.exists()) {
      const currentWallet = initiatorSnap.data().wallet || 0;
      await updateDoc(initiatorRef, {
        wallet: currentWallet + refundAmount
      });
    }
  }

  // Возвращаем ставку оппоненту если он заплатил
  if (battle.opponentPaid && battle.opponentId && refundAmount > 0) {
    const opponentRef = doc(db, "users", battle.opponentId.toString());
    const opponentSnap = await getDoc(opponentRef);
    
    if (opponentSnap.exists()) {
      const currentWallet = opponentSnap.data().wallet || 0;
      await updateDoc(opponentRef, {
        wallet: currentWallet + refundAmount
      });
    }
  }

  await updateBattle(db, battleId, {
    status: "cancelled",
    cancelledAt: Date.now()
  });

  return battle;
}
