// pvp/pvpBattle.js
import initPvpHandlers from "./pvpHandlers.js";
import initPvpPayments from "./pvpPayments.js";
import { initGameLogic } from "./pvpGameLogic.js";

export default function initPvpModule({ bot, db }) {
  console.log("⚔️ Initializing PvP Battle module...");
  
  const context = {
    bot,
    db,
  };

  initPvpHandlers(context);
  initPvpPayments(context);
  initGameLogic(context);

  console.log("✅ PvP Battle module ready.");
}
