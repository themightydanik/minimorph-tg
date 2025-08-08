import express from "express";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase.js";
import { processReferralRewards } from "./referralRewards.js";

const router = express.Router();
const normalizeId = (id) => id?.toString().replace(/^_+/, "") || null;

router.post("/referral", async (req, res) => {
  let { telegramId, invitedBy, username, first_name } = req.body;

  telegramId = normalizeId(telegramId);
  invitedBy = normalizeId(invitedBy);

  if (!telegramId || !invitedBy || telegramId === invitedBy) {
    return res.status(400).send("Invalid data");
  }

  try {
    const userRef = doc(db, "users", telegramId);
    const referrerRef = doc(db, "users", invitedBy);

    const userSnap = await getDoc(userRef);
    const referrerSnap = await getDoc(referrerRef);

    if (!referrerSnap.exists()) {
      return res.status(400).send("Referrer does not exist");
    }

    const defaultData = {
      completedTasks: {},
      earned: {},
      energy: 0,
      invitedBy,
      lastRecordedPoints: 0,
      masterRewards: 0,
      points: 0,
      purchasedCards: [],
      refEarnings: 0,
      tickets: 10,
      tps: 0,
      username: username || first_name || `User-${telegramId}`,
    };

    if (!userSnap.exists()) {
      await setDoc(userRef, defaultData);
    } else {
      const userData = userSnap.data();
      if (!userData.invitedBy) {
        await updateDoc(userRef, { invitedBy });
      }
    }

    await updateDoc(referrerRef, {
      invitedUsers: arrayUnion(telegramId),
    });

    // Сразу начисляем бонус
    await processReferralRewards(telegramId);

    res.send("Referral recorded and bonus applied");
  } catch (error) {
    console.error("❌ Error handling referral:", error);
    res.status(500).send("Server error");
  }
});

export default router;
