import express from "express";
import { doc, getDoc, setDoc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase.js";

const router = express.Router();

router.post("/referral", async (req, res) => {
  const { telegramId, invitedBy, username, first_name } = req.body;

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
      // Создаём полноценного нового пользователя
      const newUser = {
        invitedBy,
        invitedUsers: [],
        completedTasks: {},
        points: 100,
        masterRewards: 0,
        earned: {},
        username: username || first_name || `User-${telegramId}`,
      };

      await setDoc(userRef, newUser);
    } else {
      const userData = userSnap.data();
      if (!userData.invitedBy) {
        await updateDoc(userRef, { invitedBy });
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
