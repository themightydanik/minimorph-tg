// pvp/pvpGameLogic.js - Game logic for PvP battles
import { getBattleById, updateBattle, completeBattle } from "./pvpFirebase.js";

/**
 * Инициализация игровой логики PvP
 */
export function initGameLogic({ bot, db }) {
  
  // === Обработка выбора игрока в батле ===
  bot.action(/^battle_choice_(.+)_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    
    const battleId = ctx.match[1];
    const choice = ctx.match[2]; // rock, paper, scissors
    const userId = ctx.from.id.toString();

    try {
      const battle = await getBattleById(db, battleId);

      if (!battle) {
        return ctx.reply("⚠️ Battle not found.");
      }

      if (battle.status !== "in_progress") {
        return ctx.reply("⚠️ This battle is not active.");
      }

      const isInitiator = userId === battle.initiatorId.toString();
      const isOpponent = userId === battle.opponentId?.toString();

      if (!isInitiator && !isOpponent) {
        return ctx.reply("⚠️ You are not part of this battle.");
      }

      // Сохраняем выбор игрока
      const updateData = {};
      if (isInitiator) {
        if (battle.initiatorChoice) {
          return ctx.reply("✅ You already made your choice!");
        }
        updateData.initiatorChoice = choice;
        updateData.initiatorReady = true;
      } else {
        if (battle.opponentChoice) {
          return ctx.reply("✅ You already made your choice!");
        }
        updateData.opponentChoice = choice;
        updateData.opponentReady = true;
      }

      await updateBattle(db, battleId, updateData);

      await ctx.reply(`✅ Choice registered: ${getChoiceEmoji(choice)}`);

      // Проверяем, сделали ли оба игрока выбор
      const updatedBattle = await getBattleById(db, battleId);
      
      if (updatedBattle.initiatorReady && updatedBattle.opponentReady) {
        await resolveBattle(bot, db, battleId, updatedBattle.chatId);
      } else {
        await ctx.reply("⏳ Waiting for opponent's choice...");
      }

    } catch (err) {
      console.error("Battle choice error:", err);
      await ctx.reply("⚠️ Error processing choice. Please try again.");
    }
  });
}

/**
 * Запускает батл после оплаты обоих игроков
 */
export async function startBattle(bot, db, battleId, chatId) {
  try {
    const battle = await getBattleById(db, battleId);

    if (!battle) {
      console.error("Battle not found:", battleId);
      return;
    }

    await updateBattle(db, battleId, { status: "in_progress" });

    const keyboard = {
      inline_keyboard: [
        [
          { text: "🪨 Rock", callback_data: `battle_choice_${battleId}_rock` },
          { text: "📄 Paper", callback_data: `battle_choice_${battleId}_paper` },
          { text: "✂️ Scissors", callback_data: `battle_choice_${battleId}_scissors` }
        ]
      ]
    };

    const message = 
      `⚔️ BATTLE STARTED!\n\n` +
      `👤 @${battle.initiatorUsername}\n` +
      `🆚\n` +
      `👤 @${battle.opponentUsername}\n\n` +
      `💰 Prize Pool: ${battle.prizePool} ⭐\n\n` +
      `🎮 Make your choice:`;

    // Отправляем обоим игрокам
    try {
      await bot.telegram.sendMessage(battle.initiatorId, message, { reply_markup: keyboard });
    } catch (err) {
      console.error("Error sending to initiator:", err);
    }

    try {
      await bot.telegram.sendMessage(battle.opponentId, message, { reply_markup: keyboard });
    } catch (err) {
      console.error("Error sending to opponent:", err);
    }

    // Отправляем в чат лобби если есть
    if (chatId) {
      try {
        await bot.telegram.sendMessage(chatId, 
          `⚔️ Battle started!\n` +
          `👤 @${battle.initiatorUsername} 🆚 @${battle.opponentUsername}\n` +
          `💰 Prize: ${battle.prizePool} ⭐`
        );
      } catch (err) {
        console.error("Error sending to lobby chat:", err);
      }
    }

  } catch (err) {
    console.error("Start battle error:", err);
  }
}

/**
 * Определяет победителя и завершает батл
 */
async function resolveBattle(bot, db, battleId, chatId) {
  try {
    const battle = await getBattleById(db, battleId);

    if (!battle) return;

    const result = determineWinner(
      battle.initiatorChoice,
      battle.opponentChoice
    );

    let winnerId = null;
    let resultMessage = "";

    if (result === "initiator") {
      winnerId = battle.initiatorId;
      resultMessage = 
        `🏆 WINNER: @${battle.initiatorUsername}!\n\n` +
        `${getChoiceEmoji(battle.initiatorChoice)} beats ${getChoiceEmoji(battle.opponentChoice)}\n\n` +
        `💰 Prize: ${battle.prizePool} ⭐`;
    } else if (result === "opponent") {
      winnerId = battle.opponentId;
      resultMessage = 
        `🏆 WINNER: @${battle.opponentUsername}!\n\n` +
        `${getChoiceEmoji(battle.opponentChoice)} beats ${getChoiceEmoji(battle.initiatorChoice)}\n\n` +
        `💰 Prize: ${battle.prizePool} ⭐`;
    } else {
      resultMessage = 
        `🤝 IT'S A TIE!\n\n` +
        `Both chose ${getChoiceEmoji(battle.initiatorChoice)}\n\n` +
        `💰 Prize pool ${battle.prizePool} ⭐ split between players`;
      
      // При ничьей делим приз пополам
      if (battle.prizePool > 0) {
        const halfPrize = battle.prizePool / 2;
        
        const { doc, getDoc, updateDoc } = await import("firebase/firestore");
        
        const initiatorRef = doc(db, "users", battle.initiatorId.toString());
        const opponentRef = doc(db, "users", battle.opponentId.toString());
        
        const [initiatorSnap, opponentSnap] = await Promise.all([
          getDoc(initiatorRef),
          getDoc(opponentRef)
        ]);
        
        if (initiatorSnap.exists()) {
          await updateDoc(initiatorRef, {
            wallet: (initiatorSnap.data().wallet || 0) + halfPrize
          });
        }
        
        if (opponentSnap.exists()) {
          await updateDoc(opponentRef, {
            wallet: (opponentSnap.data().wallet || 0) + halfPrize
          });
        }
      }
    }

    // Завершаем батл
    await completeBattle(db, battleId, winnerId);

    // Отправляем результаты обоим игрокам
    try {
      await bot.telegram.sendMessage(battle.initiatorId, resultMessage);
    } catch (err) {
      console.error("Error sending result to initiator:", err);
    }

    try {
      await bot.telegram.sendMessage(battle.opponentId, resultMessage);
    } catch (err) {
      console.error("Error sending result to opponent:", err);
    }

    // Отправляем в чат лобби
    if (chatId) {
      try {
        await bot.telegram.sendMessage(chatId, resultMessage);
      } catch (err) {
        console.error("Error sending result to lobby:", err);
      }
    }

  } catch (err) {
    console.error("Resolve battle error:", err);
  }
}

/**
 * Определяет победителя по правилам "камень-ножницы-бумага"
 */
function determineWinner(choice1, choice2) {
  if (choice1 === choice2) return "tie";

  const winConditions = {
    rock: "scissors",
    paper: "rock",
    scissors: "paper"
  };

  return winConditions[choice1] === choice2 ? "initiator" : "opponent";
}

/**
 * Возвращает эмодзи для выбора
 */
function getChoiceEmoji(choice) {
  const emojis = {
    rock: "🪨",
    paper: "📄",
    scissors: "✂️"
  };
  return emojis[choice] || "❓";
}
