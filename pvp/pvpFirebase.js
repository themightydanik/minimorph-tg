// pvp/pvpFirebase.js
import { collection, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";

export async function createBattle(db, user, prizePool) {
  const id = `battle_${Date.now()}`;
  const battleRef = doc(db, "TGBattles", id);
  const data = {
    id,
    initiatorId: user.id,
    initiatorUsername: user.username,
    prizePool,
    status: "awaiting_accept",
    initiatorPaid: false, // ✅ отдельные поля оплаты
    opponentPaid: false,
    createdAt: Date.now(),
  };
  await setDoc(battleRef, data);
  return data;
}

export async function getBattleById(db, id) {
  const ref = doc(db, "TGBattles", id);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

export async function updateBattle(db, id, data) {
  const ref = doc(db, "TGBattles", id);
  await updateDoc(ref, data);
}
