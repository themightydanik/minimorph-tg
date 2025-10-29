// pvp/pvpGameLogic.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";

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
    if (!chatId) return console.error("⚠️ No chatId for battle messages");

    // ✅ Проверяем, можно ли кидать кубик
    if (battle.status !== "in_progress") {
      return bot.telegram.sendMessage(chatId, "⏳ Battle hasn’t started yet!");
    }

    const user = ctx.from;

    // ✅ Проверяем порядок хода
    if (battle.turn === "initiator" && user.id !== battle.initiatorId) {
      return bot.telegram.sendMessage(chatId, "⏳ Wait for your turn. Initiator goes first!");
    }
    if (battle.turn === "opponent" && user.id !== battle.opponentId) {
      return bot.telegram.sendMessage(chatId, "⏳ Wait for your turn. Opponent goes next!");
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    let updateData = {};

    if (user.id === battle.initiatorId && !battle.initiatorRoll) {
      updateData.initiatorRoll = roll;
      updateData.turn = "opponent"; // передаём ход оппоненту
    } else if (user.id === battle.opponentId && !battle.opponentRoll) {
      updateData.opponentRoll = roll;
      updateData.turn = null; // оба сделали ход
    } else {
      return bot.telegram.sendMessage(chatId, "⚠️ You’ve already rolled the dice!");
    }

    await updateBattle(db, battleId, updateData);
    await bot.telegram.sendMessage(chatId, `🎲 @${user.username} rolled the dice and got: ${roll}`);

    // ✅ Проверяем, бросили ли оба игрока
    const updated = await getBattleById(db, battleId);
    if (updated.initiatorRoll && updated.opponentRoll) {
      const initiator = updated.initiatorUsername;
      const opponent = updated.opponentUsername;

      let winner;
      if (updated.initiatorRoll > updated.opponentRoll) {
        winner = initiator;
      } else if (updated.initiatorRoll < updated.opponentRoll) {
        winner = opponent;
      } else {
        winner = null; // ничья
      }

      if (winner) {
        await bot.telegram.sendMessage(chatId, `🏆 Winner: @${winner}`);
        await updateBattle(db, battleId, { status: "finished", winner });
      } else {
        await bot.telegram.sendMessage(chatId, "🤝 It’s a draw!");
        await updateBattle(db, battleId, { status: "finished", winner: "draw" });
      }
    }
  });
}

/**
 * Старт батла
 */
export async function startBattle(bot, db, battleId, chatIdFromCtx) {
  const battle = await getBattleById(db, battleId);
  if (!battle) return;

  const chatId = battle.chatId || chatIdFromCtx;
  if (!chatId) return console.error("⚠️ No chatId to start the battle");

  // Для платного батла проверяем оплату
  if (battle.prizePool > 0 && battle.status !== "paid_by_both") {
    console.log(`⚠️ Battle ${battleId} cannot start until both players have paid.`);
    return;
  }

  // Сохраняем chatId, если ещё нет
  if (!battle.chatId) await updateBattle(db, battleId, { chatId });

  // Обновляем статус и устанавливаем первый ход
  await updateBattle(db, battleId, { status: "in_progress", turn: "initiator" });

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎲 Roll the Dice!", callback_data: `pvp_roll_${battleId}` }],
    ],
  };

  const message = `
🔥 The battle has begun!
👤 @${battle.initiatorUsername} vs 👤 @${battle.opponentUsername}

@${battle.initiatorUsername}, it's your turn first! 🎲
  `;

  await bot.telegram.sendMessage(chatId, message, { reply_markup: keyboard });
}
