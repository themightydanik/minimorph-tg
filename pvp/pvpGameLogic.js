// pvp/pvpGameLogic.js
import { updateBattle, getBattleById } from "./pvpFirebase.js";

export function initGameLogic({ bot, db }) {
  bot.action(/^pvp_roll_(.+)$/, async (ctx) => {
    await ctx.answerCbQuery();
    const battleId = ctx.match[1];
    const battle = await getBattleById(db, battleId);
    if (!battle) return ctx.reply("⚠️ Battle not found.");

    const roll = Math.floor(Math.random() * 6) + 1;
    const user = ctx.from;

    if (user.id === battle.initiatorId) {
      await updateBattle(db, battleId, { initiatorRoll: roll });
    } else if (user.id === battle.opponentId) {
      await updateBattle(db, battleId, { opponentRoll: roll });
    }

    await ctx.reply(`🎲 @${user.username} rolled the dice and got: ${roll}`);

    const updated = await getBattleById(db, battleId);
    if (updated.initiatorRoll && updated.opponentRoll) {
      const winner =
        updated.initiatorRoll > updated.opponentRoll
          ? updated.initiatorUsername
          : updated.opponentUsername;
      await ctx.reply(`🏆 Winner: @${winner}`);
    }
  });
}

export async function startBattle(bot, db, battleId) {
  const battle = await getBattleById(db, battleId);
  if (!battle) return;

  const keyboard = {
    inline_keyboard: [
      [{ text: "🎲 Roll the Dice!", callback_data: `pvp_roll_${battleId}` }],
    ],
  };

  await bot.telegram.sendMessage(
    battle.initiatorId,
    `🎮 The battle began against @${battle.opponentUsername}!`,
    { reply_markup: keyboard }
  );

  await bot.telegram.sendMessage(
    battle.opponentId,
    `🎮 The battle began against @${battle.initiatorUsername}!`,
    { reply_markup: keyboard }
  );

  await updateBattle(db, battleId, { status: "in_progress" });
}
