const { Bot, InlineKeyboard } = require("grammy");
const fs = require("fs");

const bot = new Bot("8752348602:AAFvkRDGkuOpU2W0pAVr9KENNQs7NRhHK7g");
const DB_FILE = "telepay-data.json";

function loadData() {
  if (!fs.existsSync(DB_FILE)) {
    return { balances: {}, usernames: {} };
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

  if (data.balances[userId] === undefined) {
    data.balances[userId] = 100;
  }
  if (username) {
    data.usernames[username.toLowerCase()] = userId;
  }
  saveData(data);

  ctx.reply("Welcome! You've been given 100 fake coins to start.");
});

bot.command("balance", (ctx) => {
  const data = loadData();
  const userId = ctx.from.id;
  const amount = data.balances[userId] || 0;
  ctx.reply(`Your balance is ${amount} coins.`);
});

bot.command("send", (ctx) => {
  const data = loadData();
  const senderId = ctx.from.id;
  const parts = ctx.match.split(" ");
  const targetUsername = parts[0].replace("@", "").toLowerCase();
  const amount = parseInt(parts[1]);

  const recipientId = data.usernames[targetUsername];

  if (!recipientId) {
    ctx.reply("I don't know that username yet. Ask them to send /start to me first.");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    ctx.reply("Please enter a valid amount, like: /send @username 20");
    return;
  }

  const senderBalance = data.balances[senderId] || 0;
  if (senderBalance < amount) {
    ctx.reply("You don't have enough coins for that.");
    return;
  }

  if (!data.transactions) data.transactions = [];
  data.transactions.push({
    type: "send",
    from: senderId,
    to: recipientId,
    amount,
    date: new Date().toISOString()
  });
  saveData(data);
  ctx.api.sendMessage(recipientId, `You received ${amount} coins from @${ctx.from.username}!`);
});

bot.command("request", (ctx) => {
  const data = loadData();
  const requesterId = ctx.from.id;
  const requesterUsername = ctx.from.username;
  const parts = ctx.match.split(" ");
  const targetUsername = parts[0].replace("@", "").toLowerCase();
  const amount = parseInt(parts[1]);

  const targetId = data.usernames[targetUsername];

  if (!targetId) {
    ctx.reply("I don't know that username yet. Ask them to send /start to me first.");
    return;
  }
  if (isNaN(amount) || amount <= 0) {
    ctx.reply("Please enter a valid amount, like: /request @username 20");
    return;
  }

  const keyboard = new InlineKeyboard()
    .text("✅ Confirm Payment", `pay_confirm:${amount}:${requesterId}`)
    .text("❌ Decline", `pay_decline:${amount}:${requesterId}`);

  ctx.api.sendMessage(
    targetId,
    `@${requesterUsername} is requesting ${amount} coins.`,
    { reply_markup: keyboard }
  );

  ctx.reply(`Request sent to @${targetUsername}.`);
});

bot.callbackQuery(/^pay_confirm:(\d+):(\d+)$/, (ctx) => {
  const data = loadData();
  const amount = parseInt(ctx.match[1]);
  const requesterId = parseInt(ctx.match[2]);
  const payerId = ctx.from.id;

  const payerBalance = data.balances[payerId] || 0;
  if (payerBalance < amount) {
    ctx.reply("You don't have enough coins for this payment.");
    return;
  }

  data.balances[payerId] = payerBalance - amount;
  data.balances[requesterId] = (data.balances[requesterId] || 0) + amount;
  saveData(data);

  ctx.reply(`You paid ${amount} coins.`);
  ctx.api.sendMessage(requesterId, `Your request for ${amount} coins was paid!`);
});

bot.callbackQuery(/^pay_decline:(\d+):(\d+)$/, (ctx) => {
  const requesterId = parseInt(ctx.match[2]);
  ctx.reply("You declined the request.");
  ctx.api.sendMessage(requesterId, "Your payment request was declined.");
});
bot.callbackQuery(/^webreq:(\d+):(confirm|decline)$/, (ctx) => {
  const index = parseInt(ctx.match[1]);
  const action = ctx.match[2];
  const data = loadData();

  if (!data.requests || !data.requests[index] || data.requests[index].status !== "pending") {
    ctx.reply("This request is no longer available.");
    return;
  }

  const request = data.requests[index];

  if (action === "decline") {
    request.status = "declined";
    saveData(data);
    ctx.reply("You declined the request.");
    bot.api.sendMessage(request.requesterId, "Your payment request was declined.");
    return;
  }

  const payerBalance = data.balances[request.targetId] || 0;
  if (payerBalance < request.amount) {
    ctx.reply("You don't have enough coins for this payment.");
    return;
  }

  data.balances[request.targetId] = payerBalance - request.amount;
  data.balances[request.requesterId] = (data.balances[request.requesterId] || 0) + request.amount;
  request.status = "confirmed";
  saveData(data);

  ctx.reply(`You paid ${request.amount} coins.`);
  bot.api.sendMessage(request.requesterId, `Your request for ${request.amount} coins was paid!`);
});
bot.command("history", (ctx) => {
  const data = loadData();
  const userId = ctx.from.id;
  const transactions = (data.transactions || [])
    .filter(t => t.from === userId || t.to === userId)
    .slice(-10)
    .reverse();

  if (transactions.length === 0) {
    ctx.reply("You have no transactions yet.");
    return;
  }

  const lines = transactions.map(t => {
    const direction = t.from === userId ? "Sent" : "Received";
    const date = new Date(t.date).toLocaleDateString();
    return `${direction} ${t.amount} coins — ${date}`;
  });

  ctx.reply(`Your last ${transactions.length} transactions:\n\n${lines.join("\n")}`);
});

bot.start();