// pvp/pvpGameLogic.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";

export function initGameLogic({ bot, db }) {
  bot.action(/^pvp_roll_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    // ✅ Проверяем, можно ли вообще кидать кубик
    if (battle.status !== "in_progress") {
      return ctx.reply("⏳ Battle hasn’t started yet!");
    }

    const roll = Math.floor(Math.random() * 6) + 1;
    const user = ctx.from;

    let updateData = {};
    if (user.id === battle.initiatorId && !battle.initiatorRoll) {
      updateData.initiatorRoll = roll;
    } else if (user.id === battle.opponentId && !battle.opponentRoll) {
      updateData.opponentRoll = roll;
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

  // ✅ Разрешаем запуск только если обе оплаты прошли
  if (battle.status !== "paid_by_both") {
    console.log(`⚠️ Battle ${battleId} cannot start until both players have paid.`);
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎲 Roll the Dice!", callback_data: `pvp_roll_${battleId}` }],
    ],
  };

  await bot.telegram.sendMessage(
    battle.initiatorId,
    `🎮 The battle has begun against @${battle.opponentUsername}!`,
    { reply_markup: keyboard }
  );

  await bot.telegram.sendMessage(
    battle.opponentId,
    `🎮 The battle has begun against @${battle.initiatorUsername}!`,
    { reply_markup: keyboard }
  );

  await updateBattle(db, battleId, { status: "in_progress" });
}
