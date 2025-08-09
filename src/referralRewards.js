import { doc, updateDoc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// Удаляет подчеркивания в начале ID
const normalizeId = (id) => id.toString().replace(/^_+/, "");

/**
 * Начисляет реферальную награду для одного конкретного пользователя (по telegramId)
 * @param {string} telegramId - Telegram ID текущего пользователя
 */
export const processReferralRewards = async (telegramId) => {
  const cleanTelegramId = normalizeId(telegramId);
  const userRef = doc(db, "users", cleanTelegramId);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  const user = userSnap.data();
  const inviterId = user.invitedBy ? normalizeId(user.invitedBy) : null;

  if (!inviterId || inviterId === cleanTelegramId) return;

  const inviterRef = doc(db, "users", inviterId);
  const inviterSnap = await getDoc(inviterRef);
  if (!inviterSnap.exists()) return;

  const inviter = inviterSnap.data();
  const alreadyEarned = inviter.earned?.[cleanTelegramId] || 0;
  const finalBonus = 10000;

  if (alreadyEarned >= finalBonus) return;

  const updatedEarned = {
    ...(inviter.earned || {}),
    [cleanTelegramId]: finalBonus,
  };

  await updateDoc(inviterRef, {
    points: (inviter.points || 0) + finalBonus,
    masterRewards: (inviter.masterRewards || 0) + finalBonus,
    earned: updatedEarned,
  });

  console.log(`✅ Gave ${finalBonus} to inviter ${inviterId} for user ${cleanTelegramId}`);
};
