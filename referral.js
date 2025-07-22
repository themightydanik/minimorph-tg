const express = require("express");
const { doc, getDoc, setDoc, updateDoc, arrayUnion } = require("firebase/firestore");
const { db } = require("./firebase"); // убедись, что этот путь правильный

const router = express.Router();

router.post("/referral", async (req, res) => {
  const { userId, referredBy } = req.body;

  if (!userId || !referredBy || userId === referredBy) {
    return res.status(400).send("Invalid data");
  }

  try {
    const userRef = doc(db, "users", userId);
    const referrerRef = doc(db, "users", referredBy);

    const userSnap = await getDoc(userRef);
    const referrerSnap = await getDoc(referrerRef);

    if (!referrerSnap.exists()) {
      return res.status(400).send("Referrer does not exist");
    }

    if (!userSnap.exists()) {
      await setDoc(userRef, {
        points: 0,
        invitedBy: referredBy,
        invitedUsers: [],
      });
    } else {
      const userData = userSnap.data();
      if (!userData.invitedBy) {
        await updateDoc(userRef, { invitedBy: referredBy });
      }
    }

    await updateDoc(referrerRef, {
      invitedUsers: arrayUnion(userId),
    });

    res.send("Referral recorded");
  } catch (error) {
    console.error("❌ Error handling referral:", error);
    res.status(500).send("Server error");
  }
});

module.exports = router;
