const { Bot, InlineKeyboard } = require("grammy");
const { TonClient } = require("@ton/ton");
const fs = require("fs");

const bot = new Bot(process.env.BOT_TOKEN);
const DB_FILE = "telepay-data.json";

const tonClient = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
});

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    return { balances: {}, usernames: {}, tonWallets: {}, transactions: [] };
  }
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function saveData(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

bot.command("start", (ctx) => {
  const data = loadData();
  const userId = ctx.from.id;
  const username = ctx.from.username;

  if (username) {
    if (!data.usernames) data.usernames = {};
    data.usernames[username.toLowerCase()] = userId;
    saveData(data);
  }

  ctx.reply(
    "Welcome to Telepay! Open your wallet below to connect a TON wallet, then use /send and /request to move real testnet TON."
  );
});

bot.command("tonbalance", async (ctx) => {
  const data = loadData();
  const userId = ctx.from.id;
  const tonAddress = data.tonWallets?.[userId];

  if (!tonAddress) {
    ctx.reply("You haven't connected a TON wallet yet. Open your Telepay wallet and tap Connect Wallet first.");
    return;
  }

  try {
    const balance = await tonClient.getBalance(tonAddress);
    const tonAmount = Number(balance) / 1_000_000_000;
    ctx.reply(`Your TON balance: ${tonAmount} TON`);
  } catch (error) {
    ctx.reply("Couldn't fetch your balance right now. Try again shortly.");
  }
});

bot.command("send", (ctx) => {
  const parts = ctx.match.split(" ");
  const targetUsername = parts[0]?.replace("@", "");
  const amount = parts[1];

  if (!targetUsername || !amount) {
    ctx.reply("Usage: /send @username amount");
    return;
  }

  const miniAppUrl = `https://telepay-production.up.railway.app?to=${requesterUsername}&amount=${amount}`;
const keyboard = new InlineKeyboard()
  .webApp("Open to pay", miniAppUrl)
  .row()
  .text("❌ Decline", `declinereq:${requesterId}:${amount}:${requesterUsername}`);

  ctx.reply(
    `Ready to send ${amount} TON to @${targetUsername}. Tap below to review and confirm in your wallet.`,
    { reply_markup: keyboard }
  );
});

bot.command("request", (ctx) => {
  const requesterUsername = ctx.from.username;
  const parts = ctx.match.split(" ");
  const amount = parts[0];
  const targetUsername = parts[1]?.replace("@", "");

  if (!amount || !targetUsername) {
    ctx.reply("Usage: /request amount @username");
    return;
  }

  const data = loadData();
  const targetId = data.usernames?.[targetUsername.toLowerCase()];

  if (!targetId) {
    ctx.reply("I don't know that username yet. Ask them to send /start to me first.");
    return;
  }

  const miniAppUrl = `https://telepay-production.up.railway.app?to=${requesterUsername}&amount=${amount}`;
  const keyboard = new InlineKeyboard().webApp("Open to pay", miniAppUrl);

  ctx.api.sendMessage(
    targetId,
    `@${requesterUsername} is requesting ${amount} TON from you. Tap below to review and pay from your wallet.`,
    { reply_markup: keyboard }
  );

  ctx.reply(`Request sent to @${targetUsername}.`);
});

bot.command("history", async (ctx) => {
  const userId = ctx.from.id;

  try {
    const response = await fetch(`https://telepay-production.up.railway.app/transactions/${userId}`);
    const data = await response.json();

    if (!data.transactions || data.transactions.length === 0) {
      ctx.reply("You have no transactions yet.");
      return;
    }

    const lines = data.transactions.map(t => {
      const isSender = t.from == userId;
      const direction = isSender ? "Sent" : "Received";
      const date = new Date(t.date).toLocaleDateString();
      return `${direction} ${t.amount} TON — ${date}`;
    });

    ctx.reply(`Your last ${data.transactions.length} transactions:\n\n${lines.join("\n")}`);
  } catch (error) {
    ctx.reply("Couldn't load your transaction history right now.");
  }
});

bot.callbackQuery(/^declinereq:(.+)$/, async (ctx) => {
  const requestId = ctx.match[1];
  const data = loadData();
  const request = data.pendingRequests?.[requestId];

  if (!request) {
    await ctx.editMessageText("This request is no longer available.");
    return;
  }

  await ctx.editMessageText("❌ You declined this request.");
  ctx.api.sendMessage(request.requesterId, `Your request for ${request.amount} TON was declined.`);

  delete data.pendingRequests[requestId];
  saveData(data);
});

bot.start();