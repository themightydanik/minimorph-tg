import express from "express";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase.js"; // Проверь путь, добавь .js если нужно

const router = express.Router();

router.post("/referral", async (req, res) => {
  const { telegramId, invitedBy } = req.body;

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

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        points: 0,
        invitedBy: invitedBy,
        invitedUsers: [],
      });
    } else {
      const userData = userSnap.data();
      if (!userData.invitedBy) {
        await updateDoc(userRef, { invitedBy: invitedBy });
      }
    }

    await updateDoc(referrerRef, {
      invitedUsers: arrayUnion(telegramId),
    });

    res.send("Referral recorded");
  } catch (error) {
    console.error("❌ Error handling referral:", error);
    res.status(500).send("Server error");
  }
});

export default router;
