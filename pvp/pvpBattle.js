// pvp/pvpBattle.js
import initPvpPayments from "./pvpPayments.js";
import { initGameLogic } from "./pvpGameLogic.js";

export default function initPvpModule({ bot, db }) {
  console.log("⚔️ Initializing PvP Battle module...");

  const context = { bot, db };

  // Убираем initPvpHandlers — его код теперь в index.js
  initPvpPayments(context);
  initGameLogic(context);

  console.log("✅ PvP Battle module ready.");
}
