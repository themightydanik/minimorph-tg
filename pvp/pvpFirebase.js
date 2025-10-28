// pvp/pvpFirebase.js
import { collection, doc, setDoc, getDoc, updateDoc } from "firebase/firestore";

export async function createBattle(db, user, prizePool) {
  const id = `battle_${Date.now()}`;
  const battleRef = doc(db, "TGBattles", id);

  const status = prizePool === 0 ? "ready_to_start" : "awaiting_accept";

  const data = {
    id,
    initiatorId: user.id.toString(),
    initiatorUsername: user.username || "",
    opponentId: null,
    opponentUsername: null,
    prizePool,
    status,             // awaiting_accept | ready_to_start | paid_by_both | in_progress | finished
    turn: prizePool === 0 ? "initiator" : null, // чей ход
    initiatorPaid: prizePool === 0 ? true : false,
    opponentPaid: prizePool === 0 ? true : false,
    initiatorRoll: null,
    opponentRoll: null,
    winner: null,
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
