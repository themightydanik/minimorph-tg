// pvp/pvpGameLogic.js (FIXED - type comparisons)
import { updateBattle, getBattleById } from "./pvpFirebase.js";
import { doc, runTransaction } from "firebase/firestore";

/**
 * Инициализация логики PvP батлов
 */
export function initGameLogic({ bot, db }) {
  bot.action(/^pvp_roll_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    
    if (!battle) return ctx.reply("⚠️ Battle not found.");
    
    const chatId = battle.chatId || ctx.chat?.id;
    if (!chatId) {
      console.error("⚠️ No chatId for battle messages");
      return ctx.reply("⚠️ Battle chat not found. Please contact admin.");
    }

    // ✅ Проверяем, можно ли кидать кубик
    if (battle.status !== "in_progress") {
      return bot.telegram.sendMessage(chatId, "⏳ Battle hasn't started yet!");
    }

    const user = ctx.from;
    const userIdStr = user.id.toString(); // 🔒 Преобразуем в строку для сравнения

    // ✅ Проверяем порядок хода (сравниваем строки)
    if (battle.turn === "initiator" && userIdStr !== battle.initiatorId.toString()) {
      return bot.telegram.sendMessage(
        chatId, 
        `⏳ Wait for your turn. @${battle.initiatorUsername} goes first!`
      );
    }
    if (battle.turn === "opponent" && userIdStr !== battle.opponentId?.toString()) {
      return bot.telegram.sendMessage(
        chatId, 
        `⏳ Wait for your turn. @${battle.opponentUsername} goes next!`
      );
    }

    // 🔒 Проверяем, не сделал ли игрок уже ход
    if (userIdStr === battle.initiatorId.toString() && battle.initiatorRoll) {
      return ctx.reply("⚠️ You've already rolled the dice!");
    }
    if (userIdStr === battle.opponentId?.toString() && battle.opponentRoll) {
      return ctx.reply("⚠️ You've already rolled the dice!");
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    let updateData = {};

    if (userIdStr === battle.initiatorId.toString() && !battle.initiatorRoll) {
      updateData.initiatorRoll = roll;
      updateData.turn = "opponent"; // передаём ход оппоненту
    } else if (userIdStr === battle.opponentId?.toString() && !battle.opponentRoll) {
      updateData.opponentRoll = roll;
      updateData.turn = null; // оба сделали ход
    }

    await updateBattle(db, battleId, updateData);

    await bot.telegram.sendMessage(
      chatId, 
      `🎲 @${user.username || user.first_name} rolled the dice and got: ${roll}`
    );

    // ✅ Проверяем, бросили ли оба игрока
    const updated = await getBattleById(db, battleId);
    
    if (updated.initiatorRoll && updated.opponentRoll) {
      await finalizeBattle(bot, db, updated, chatId);
    }
  });
}

/**
 * 🏆 Завершение батла с выплатой приза
 */
async function finalizeBattle(bot, db, battle, chatId) {
  const initiatorRoll = battle.initiatorRoll;
  const opponentRoll = battle.opponentRoll;
  const initiatorUsername = battle.initiatorUsername;
  const opponentUsername = battle.opponentUsername;

  let winner = null;
  let winnerId = null;
  
  if (initiatorRoll > opponentRoll) {
    winner = initiatorUsername;
    winnerId = battle.initiatorId;
  } else if (initiatorRoll < opponentRoll) {
    winner = opponentUsername;
    winnerId = battle.opponentId;
  }

  // Обновляем статус батла
  await updateBattle(db, battle.id, { 
    status: "finished", 
    winner: winner || "draw",
    finishedAt: Date.now()
  });

  if (winner) {
    await bot.telegram.sendMessage(
      chatId, 
      `🏆 Winner: @${winner}!\n` +
      `🎲 @${initiatorUsername}: ${initiatorRoll}\n` +
      `🎲 @${opponentUsername}: ${opponentRoll}`
    );

    // 💰 Выплата приза победителю (если есть призовой пул)
    if (battle.prizePool > 0) {
      await rewardWinner(db, winnerId, battle.prizePool, battle.id);
      
      await bot.telegram.sendMessage(
        winnerId,
        `🎉 Congratulations! You won ${battle.prizePool} ⭐ in the battle!\n` +
        `💰 The prize has been added to your Wallet.`
      );
    }
  } else {
    // Ничья
    await bot.telegram.sendMessage(
      chatId, 
      `🤝 It's a draw!\n` +
      `🎲 @${initiatorUsername}: ${initiatorRoll}\n` +
      `🎲 @${opponentUsername}: ${opponentRoll}`
    );

    // 💰 При ничьей возвращаем ставки обоим игрокам
    if (battle.prizePool > 0) {
      const refund = battle.prizePool / 2;
      await refundPlayer(db, battle.initiatorId, refund, battle.id, "draw");
      await refundPlayer(db, battle.opponentId, refund, battle.id, "draw");

      await bot.telegram.sendMessage(
        battle.initiatorId,
        `💸 Draw! Your ${refund} ⭐ stake has been refunded to your Wallet.`
      );
      await bot.telegram.sendMessage(
        battle.opponentId,
        `💸 Draw! Your ${refund} ⭐ stake has been refunded to your Wallet.`
      );
    }
  }
}

/**
 * 💰 Выплата приза победителю (атомарная транзакция)
 */
async function rewardWinner(db, winnerId, amount, battleId) {
  const userRef = doc(db, "users", winnerId.toString());

  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists()) {
        throw new Error("Winner not found in database");
      }

      const currentWallet = userSnap.data().wallet || 0;
      transaction.update(userRef, { 
        wallet: currentWallet + amount,
        lastWalletUpdate: Date.now()
      });

      // 📝 Логируем выплату
      const transactionRef = doc(db, "transactions", `reward_${battleId}_${Date.now()}`);
      transaction.set(transactionRef, {
        type: "pvp_reward",
        userId: winnerId.toString(),
        amount,
        battleId,
        timestamp: Date.now(),
        status: "completed"
      });
    });

    console.log(`✅ Rewarded ${winnerId} with ${amount} ⭐ from battle ${battleId}`);
  } catch (err) {
    console.error(`❌ Failed to reward winner ${winnerId}:`, err);
  }
}

/**
 * 💸 Возврат ставки при ничьей (атомарная транзакция)
 */
async function refundPlayer(db, playerId, amount, battleId, reason) {
  const userRef = doc(db, "users", playerId.toString());

  try {
    await runTransaction(db, async (transaction) => {
      const userSnap = await transaction.get(userRef);
      
      if (!userSnap.exists()) {
        throw new Error("Player not found in database");
      }

      const currentWallet = userSnap.data().wallet || 0;
      transaction.update(userRef, { 
        wallet: currentWallet + amount,
        lastWalletUpdate: Date.now()
      });

      // 📝 Логируем возврат
      const transactionRef = doc(db, "transactions", `refund_${battleId}_${playerId}_${Date.now()}`);
      transaction.set(transactionRef, {
        type: "pvp_refund",
        userId: playerId.toString(),
        amount,
        battleId,
        reason,
        timestamp: Date.now(),
        status: "completed"
      });
    });

    console.log(`✅ Refunded ${playerId} with ${amount} ⭐ (${reason})`);
  } catch (err) {
    console.error(`❌ Failed to refund player ${playerId}:`, err);
  }
}

/**
 * 🎮 Старт батла
 */
export async function startBattle(bot, db, battleId, chatIdFromCtx) {
  const battle = await getBattleById(db, battleId);
  if (!battle) {
    console.error(`⚠️ Battle ${battleId} not found`);
    return;
  }

  const chatId = battle.chatId || chatIdFromCtx;
  if (!chatId) {
    console.error(`⚠️ No chatId to start the battle ${battleId}`);
    return;
  }

  // Для платного батла проверяем оплату
  if (battle.prizePool > 0 && battle.status !== "paid_by_both") {
    console.log(`⚠️ Battle ${battleId} cannot start until both players have paid.`);
    return;
  }

  // Сохраняем chatId, если ещё нет
  if (!battle.chatId) {
    await updateBattle(db, battleId, { chatId });
  }

  // Обновляем статус и устанавливаем первый ход
  await updateBattle(db, battleId, { 
    status: "in_progress", 
    turn: "initiator",
    startedAt: Date.now()
  });

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎲 Roll the Dice!", callback_data: `pvp_roll_${battleId}` }],
    ],
  };

  const prizeInfo = battle.prizePool > 0 
    ? `💰 Prize Pool: ${battle.prizePool} ⭐` 
    : "🎯 Playing for fun (no prize)";

  const message = `
🔥 The battle has begun!

👤 @${battle.initiatorUsername} vs 👤 @${battle.opponentUsername}
${prizeInfo}

@${battle.initiatorUsername}, it's your turn first! 🎲
  `.trim();

  await bot.telegram.sendMessage(chatId, message, { reply_markup: keyboard });
}
