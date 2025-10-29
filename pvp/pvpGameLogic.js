// pvp/pvpGameLogic.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";

export function initGameLogic({ bot, db }) {
  bot.action(/^pvp_roll_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    // ✅ Проверяем, можно ли кидать кубик
    if (battle.status !== "in_progress") {
      return ctx.reply("⏳ Battle hasn’t started yet!");
    }

    const user = ctx.from;

    // ✅ Проверяем порядок хода
    if (battle.turn === "initiator" && user.id !== battle.initiatorId) {
      return ctx.reply("⏳ Wait for your turn. Initiator goes first!");
    }
    if (battle.turn === "opponent" && user.id !== battle.opponentId) {
      return ctx.reply("⏳ Wait for your turn. Opponent goes next!");
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
      return ctx.reply("⚠️ You’ve already rolled the dice!");
    }

    await updateBattle(db, battleId, updateData);
    await ctx.reply(`🎲 @${user.username} rolled the dice and got: ${roll}`);

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
        await ctx.reply(`🏆 Winner: @${winner}`);
        await updateBattle(db, battleId, { status: "finished", winner });
      } else {
        await ctx.reply("🤝 It’s a draw!");
        await updateBattle(db, battleId, { status: "finished", winner: "draw" });
      }
    }
  });
}

export async function startBattle(bot, db, battleId) {
  const battle = await getBattleById(db, battleId);
  if (!battle) return;

  // Для платного батла проверяем оплату
  if (battle.prizePool > 0 && battle.status !== "paid_by_both") {
    console.log(`⚠️ Battle ${battleId} cannot start until both players have paid.`);
    return;
  }

  // Для батлов без приза — уже paid_by_both, поэтому стартуем
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

  await bot.telegram.sendMessage(battle.chatId, message, { reply_markup: keyboard });
}
