// slot.js
import express from "express";
import { collection, doc, getDoc, getDocs, query, where, updateDoc, setDoc } from "firebase/firestore";

/**
 * Инициализация модуля слота
 * @param {Object} params
 * @param {Telegraf} params.bot - экземпляр Telegraf (из index.js)
 * @param {Firestore} params.db - экспорт db из firebase.js
 * @param {string} params.ADMIN_ID - Telegram ID администратора (строка)
 * @param {string} params.ADMIN_SECRET - секрет для HTTP админ-эндпоинтов
 * @param {number} params.spinsPerTicket - сколько "вращений" даёт 1 ticket (по умолчанию 1)
 * @param {Object} params.rewards - настройки вознаграждений (в звёздах)
 */
export default function initSlotModule({ bot, db, ADMIN_ID, ADMIN_SECRET, spinsPerTicket = 1, rewards = { jackpot: 100, pair: 5 } }) {
  const router = express.Router();

  // --- HELPERS ---
  const normalizeId = (id) => id?.toString().replace(/^_+/, "") || null;

  const getUserById = async (telegramId) => {
    if (!telegramId) return null;
    const cleanId = normalizeId(telegramId);
    const ref = doc(db, "users", cleanId);
    const snap = await getDoc(ref);
    return snap.exists() ? { ref, data: snap.data() } : null;
  };

  const getUserByUsername = async (username) => {
    if (!username) return null;
    const usersCol = collection(db, "users");
    const q = query(usersCol, where("username", "==", username));
    const snap = await getDocs(q);
    if (snap.empty) return null;
    // берём первый результат (в коллекции username уникальны у тебя)
    const docSnap = snap.docs[0];
    return { ref: doc(db, "users", docSnap.id), data: docSnap.data(), id: docSnap.id };
  };

  // Ensure user document has slot-related fields
  const ensureSlotFields = async (userRef, currentData) => {
    const toSet = {};
    if (currentData.slotTickets === undefined) toSet.slotTickets = 0;
    if (currentData.slotSpentStars === undefined) toSet.slotSpentStars = 0;
    if (currentData.slotEarnedStars === undefined) toSet.slotEarnedStars = 0;
    if (currentData.slotWins === undefined) toSet.slotWins = 0;
    if (Object.keys(toSet).length > 0) {
      await updateDoc(userRef, toSet);
      return { ...currentData, ...toSet };
    }
    return currentData;
  };

  // --- BOT COMMANDS ---
  // /slot - показать баланс билетов и инструкцию
  bot.command("slot", async (ctx) => {
    const telegramId = ctx.from.id.toString();
    const user = await getUserById(telegramId);
    if (!user) {
      return ctx.reply("Пользователь не найден в БД. Начните игру/зарегистрируйтесь заново.");
    }
    const data = await ensureSlotFields(user.ref, user.data);
    const tickets = data.slotTickets || 0;
    const msg = `🎰 Slot Machine\n\nУ тебя ${tickets} билет(ов).\n\nЧтобы сыграть: отправь в чат эмоджи 🎰 — Telegram сам выполнит "вращение".\nОдна отправка = одно вращение (спишется 1 билет).\n\nЦена билета: платные покупки делаются через /buyticket (если настроено).`;
    await ctx.reply(msg);
  });

  // Admin shortcut inside bot to grant tickets: /grantpass <@username|telegramId> <amount>
  bot.command("grantpass", async (ctx) => {
    const from = ctx.from.id.toString();
    if (from !== ADMIN_ID) return ctx.reply("Только админ может использовать эту команду.");
    const args = ctx.message.text.split(/\s+/).slice(1);
    if (!args[0] || !args[1]) return ctx.reply("Использование: /grantpass @username|telegramId <amount>");
    const target = args[0].replace(/^@/, "");
    const amount = parseInt(args[1], 10) || 0;
    let user = null;
    if (/^\d+$/.test(target)) {
      user = await getUserById(target);
      if (!user) return ctx.reply("Пользователь с таким ID не найден.");
      await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + amount });
      return ctx.reply(`✅ Выдал ${amount} билетов пользователю ${target}`);
    } else {
      const u = await getUserByUsername(target);
      if (!u) return ctx.reply("Пользователь с таким username не найден.");
      await updateDoc(u.ref, { slotTickets: (u.data.slotTickets || 0) + amount });
      return ctx.reply(`✅ Выдал ${amount} билетов пользователю @${target}`);
    }
  });

  // --- HANDLE EMOJI SPIN (message.dice) ---
  // Мы слушаем любые сообщения с dice, фильтруем по emoji 🎰
  bot.on("message", async (ctx) => {
    try {
      const msg = ctx.message;
      if (!msg || !msg.dice) return;
      if (msg.dice.emoji !== "🎰") return; // обрабатываем только слот-эмоджи

      const telegramId = ctx.from.id.toString();
      const user = await getUserById(telegramId);
      if (!user) {
        return ctx.reply("❗ Ты не зарегистрирован в системе. Запусти /start.");
      }

      // Убедимся, что в doc есть поля слота
      const data = await ensureSlotFields(user.ref, user.data);

      // Проверка билетов
      if ((data.slotTickets || 0) <= 0) {
        // Если билетов нет — сообщаем и НЕ учитываем вращение
        return ctx.reply("У тебя нет билетов для слота. Купи билет через /buyticket или попроси админа выдать.");
      }

      // Используем значение dice.value, который возвращает Telegram (1..64)
      const val = msg.dice.value; // integer
      // Логика распределения наград на основе value (подогнана под желаемые вероятности)
      // value === 64 -> JACKPOT (≈1.56%)
      // value 49..63 -> PAIR (≈23.4%)
      // else -> MISS
      let outcome = "MISS";
      let reward = 0;
      if (val === 64) {
        outcome = "JACKPOT";
        reward = rewards.jackpot || 100;
      } else if (val >= 49) {
        outcome = "PAIR";
        reward = rewards.pair || 5;
      } else {
        outcome = "MISS";
        reward = 0;
      }

      // Обновляем Firestore атомарно (упростим: последовательные updateDoc)
      // списываем 1 билет и добавляем статистику / награду
      await updateDoc(user.ref, {
        slotTickets: (data.slotTickets || 0) - 1,
        slotSpentStars: (data.slotSpentStars || 0) + 0, // если списание звезд происходит при покупке билета, тут можно не трогать
        slotEarnedStars: (data.slotEarnedStars || 0) + reward,
        slotWins: (data.slotWins || 0) + (reward > 0 ? 1 : 0)
      });

      // Отвечаем в чат красивым сообщением
      let replyText = `🎰 Результат: ${outcome}\n`;
      if (reward > 0) {
        replyText += `💰 Ты выиграл ${reward} ⭐️ (Stars).\n`;
        replyText += `📥 Награда зачислена во внутреннюю учётку (slotEarnedStars).`;
      } else {
        replyText += `😕 Увы, ничего не выиграл. Попробуй снова!`;
      }

      // Уточнение насчет выдачи реальных Stars: далее в сообщении — инструкции
      if (reward > 0) {
        replyText += `\n\nℹ️ Примечание: чтобы перевести реальные Telegram Stars на твой аккаунт, админ должен инициировать выплату через Payments API (или вручную).`;
      }

      return ctx.reply(replyText);
    } catch (err) {
      console.error("Error handling slot dice:", err);
      return; // ничего не ломаем
    }
  });

  // --- ADMIN EXPRESS ROUTES ---
  // Безопасность: требуем x-admin-secret header (значение ADMIN_SECRET из .env)
  router.post("/admin/grant", async (req, res) => {
    try {
      const secret = req.headers["x-admin-secret"];
      if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");

      const { username, telegramId, amount } = req.body;
      const qty = parseInt(amount, 10) || 0;
      if (!qty || qty <= 0) return res.status(400).send("Invalid amount");

      if (telegramId) {
        const user = await getUserById(telegramId);
        if (!user) return res.status(404).send("User not found");
        await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + qty });
        return res.send(`Granted ${qty} tickets to ${telegramId}`);
      } else if (username) {
        const uname = username.replace(/^@/, "");
        const user = await getUserByUsername(uname);
        if (!user) return res.status(404).send("User not found");
        await updateDoc(user.ref, { slotTickets: (user.data.slotTickets || 0) + qty });
        return res.send(`Granted ${qty} tickets to @${uname}`);
      } else {
        return res.status(400).send("Provide username or telegramId");
      }
    } catch (err) {
      console.error("admin grant error:", err);
      res.status(500).send("Server error");
    }
  });

  // Админ-ручная выдача реальные Stars (ЗАГЛУШКА)
  // Важное замечание: чтобы переводить реальные Stars пользователям автоматом — нужно использовать Telegram Payments/Stars API.
  // Здесь можно добавить endpoint, который вызовет соответствующий Payments метод (при наличии provider token и настроек).
  router.post("/admin/payout-stars", async (req, res) => {
    // SECURITY
    const secret = req.headers["x-admin-secret"];
    if (!ADMIN_SECRET || secret !== ADMIN_SECRET) return res.status(403).send("Forbidden");
    // Тело: { telegramId: "123", amount: 50 }
    // Реализация зависит от того, как ты будешь интегрировать Telegram Stars (provider token и т.д.)
    return res.status(501).send("Not implemented: implement Payments API payout here with provider token");
  });

  // --- EXPORT ---
  return router;
}
