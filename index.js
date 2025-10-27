import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
dotenv.config();

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => ctx.reply('👾 Bot is running!'));

bot.launch().then(() => console.log('🤖 Bot launched with long polling'));
