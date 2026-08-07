const express = require("express");
const fs = require("fs");
const cors = require("cors");

const BOT_TOKEN = process.env.BOT_TOKEN;

function loadData() {
  if (!fs.existsSync("telepay-data.json")) {
    return { balances: {}, usernames: {}, requests: [], transactions: [] };
  }
  return JSON.parse(fs.readFileSync("telepay-data.json", "utf8"));
}

async function sendTelegramMessage(chatId, text, keyboard) {
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      reply_markup: keyboard
    })
  });
}

const app = express();
app.use(cors());
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;

app.get("/balance/:userId", (req, res) => {
  const data = loadData();
  const balance = data.balances[req.params.userId] || 0;
  console.log("Looking for userId:", req.params.userId, "Found:", data.balances);
  res.json({ balance });
});

const bodyParser = require("body-parser");
app.use(bodyParser.json());

app.post("/send", async (req, res) => {
  const { senderId, recipientUsername, amount } = req.body;

  const data = loadData();
  const recipientId = data.usernames[recipientUsername.toLowerCase()];

  if (!recipientId) {
    return res.status(400).json({ error: "Recipient not found" });
  }

  const senderBalance = data.balances[senderId] || 0;
  if (senderBalance < amount) {
    return res.status(400).json({ error: "Insufficient balance" });
  }

  data.balances[senderId] = senderBalance - amount;
data.balances[recipientId] = (data.balances[recipientId] || 0) + amount;

if (!data.transactions) data.transactions = [];
data.transactions.push({
  type: "send",
  from: senderId,
  to: recipientId,
  amount,
  date: new Date().toISOString()
});

fs.writeFileSync("telepay-data.json", JSON.stringify(data, null, 2));

  await sendTelegramMessage(recipientId, `You received ${amount} coins!`);

  res.json({ success: true, newBalance: data.balances[senderId] });
});

app.post("/request", async (req, res) => {
  const { requesterId, targetUsername, amount } = req.body;

  const data = loadData();
  const targetId = data.usernames[targetUsername.toLowerCase()];

  if (!targetId) {
    return res.status(400).json({ error: "User not found" });
  }

  if (!data.requests) data.requests = [];
  data.requests.push({ requesterId, targetId, amount, status: "pending" });
  fs.writeFileSync("telepay-data.json", JSON.stringify(data, null, 2));

  const requestIndex = data.requests.length - 1;
  await sendTelegramMessage(
    targetId,
    `Someone is requesting ${amount} coins from you.`,
    {
      inline_keyboard: [[
        { text: "✅ Confirm", callback_data: `webreq:${requestIndex}:confirm` },
        { text: "❌ Decline", callback_data: `webreq:${requestIndex}:decline` }
      ]]
    }
  );

  res.json({ success: true });
});

app.get("/requests/:userId", (req, res) => {
  const data = loadData();
  if (!data.requests) data.requests = [];

  const myRequests = data.requests
    .map((r, index) => ({ ...r, index }))
    .filter(r => r.targetId == req.params.userId && r.status === "pending");

  res.json({ requests: myRequests });
});

app.post("/requests/:index/respond", async (req, res) => {
  const { action } = req.body;
  const data = loadData();
  const request = data.requests[req.params.index];

  if (!request || request.status !== "pending") {
    return res.status(400).json({ error: "Request no longer available" });
  }

  if (action === "confirm") {
    const payerBalance = data.balances[request.targetId] || 0;
    if (payerBalance < request.amount) {
      return res.status(400).json({ error: "Insufficient balance" });
    }
    data.balances[request.targetId] = payerBalance - request.amount;
    data.balances[request.requesterId] = (data.balances[request.requesterId] || 0) + request.amount;
    request.status = "confirmed";

    if (!data.transactions) data.transactions = [];
    data.transactions.push({
      type: "request_payment",
      from: request.targetId,
      to: request.requesterId,
      amount: request.amount,
      date: new Date().toISOString()
    });
  } else {
    request.status = "declined";
  }

  fs.writeFileSync("telepay-data.json", JSON.stringify(data, null, 2));
  if (action === "confirm") {
  await sendTelegramMessage(request.requesterId, `Your request for ${request.amount} coins was paid!`);
} else {
  await sendTelegramMessage(request.requesterId, "Your payment request was declined.");
}
  res.json({ success: true });
});

app.post("/link-wallet", (req, res) => {
  const { userId, tonAddress } = req.body;
  const data = loadData();
  if (!data.tonWallets) data.tonWallets = {};
  data.tonWallets[userId] = tonAddress;
  fs.writeFileSync("telepay-data.json", JSON.stringify(data, null, 2));
  res.json({ success: true });
});

app.get("/transactions/:userId", (req, res) => {
  const data = loadData();
  const userId = req.params.userId;

  const transactions = (data.transactions || [])
    .filter(t => t.from == userId || t.to == userId)
    .slice(-10)
    .reverse();

  res.json({ transactions, userId });
});

const { TonClient } = require("@ton/ton");
const tonClient = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
});

app.get("/ton-balance/:userId", async (req, res) => {
  const data = loadData();
  const tonAddress = data.tonWallets?.[req.params.userId];

  if (!tonAddress) {
    return res.json({ balance: null, connected: false });
  }

  try {
    const balance = await tonClient.getBalance(tonAddress);
    const tonAmount = Number(balance) / 1_000_000_000;
    res.json({ balance: tonAmount, connected: true });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch balance" });
  }
});

app.get("/resolve-ton-address/:username", (req, res) => {
  const data = loadData();
  const username = req.params.username.toLowerCase();
  const targetUserId = data.usernames?.[username];

  if (!targetUserId) {
    return res.status(404).json({ error: "User not found" });
  }

  const tonAddress = data.tonWallets?.[targetUserId];
  if (!tonAddress) {
    return res.status(404).json({ error: "This user hasn't connected a TON wallet yet" });
  }

  res.json({ tonAddress });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});