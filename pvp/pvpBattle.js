// pvp/pvpBattle.js
import { initPvpWalletPayments } from "./pvp/pvpWalletPayments.js"; // 🟢 объединённый модуль
import { initGameLogic } from "./pvpGameLogic.js";

export default function initPvpModule({ bot, db }) {
  console.log("⚔️ Initializing PvP Battle module...");

  const context = { bot, db };

  // Убираем initPvpHandlers — его код теперь в index.js
  initPvpWalletPayments(context);
  initGameLogic(context);

  console.log("✅ PvP Battle module ready.");
}
