const express = require("express");
const fs = require("fs");
const cors = require("cors");
const bodyParser = require("body-parser");
const { TonClient } = require("@ton/ton");
const { Address } = require("@ton/core");

const app = express();
app.use(cors());
app.use(express.static(__dirname));
app.use(bodyParser.json());

const PORT = process.env.PORT || 3000;

const tonClient = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
});

function loadData() {
  if (!fs.existsSync("telepay-data.json")) {
    return { balances: {}, usernames: {}, tonWallets: {}, transactions: [] };
  }
  return JSON.parse(fs.readFileSync("telepay-data.json", "utf8"));
}

function saveData(data) {
  fs.writeFileSync("telepay-data.json", JSON.stringify(data, null, 2));
}

app.post("/link-wallet", (req, res) => {
  const { userId, tonAddress } = req.body;
  const data = loadData();
  if (!data.tonWallets) data.tonWallets = {};
  data.tonWallets[userId] = tonAddress;
  saveData(data);
  res.json({ success: true });
});

app.post("/log-transaction", (req, res) => {
  const { from, to, amount, explorerAddress } = req.body;
  const data = loadData();

  if (!data.transactions) data.transactions = [];
  data.transactions.push({
    from,
    to,
    amount,
    explorerAddress,
    date: new Date().toISOString()
  });
  saveData(data);

  res.json({ success: true });
});

app.post("/notify-payment", async (req, res) => {
  const { senderId, recipientUsername, amount, requestId } = req.body;
  const data = loadData();
  const recipientId = data.usernames?.[recipientUsername.toLowerCase()];

  const senderUsername = Object.keys(data.usernames || {}).find(
    username => data.usernames[username] == senderId
  ) || "someone";

  if (recipientId) {
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: recipientId,
        text: `You received ${amount} TON from @${senderUsername}!`
      })
    });
  }

  await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: senderId,
      text: `You sent ${amount} TON to @${recipientUsername}.`
    })
  });

  if (requestId && data.pendingRequests?.[requestId]) {
    const request = data.pendingRequests[requestId];
    await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/editMessageText`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: request.chatId,
        message_id: request.messageId,
        text: `✅ You paid ${amount} TON to @${senderUsername === "someone" ? recipientUsername : senderUsername}.`
      })
    });
    delete data.pendingRequests[requestId];
  }

  saveData(data);
  res.json({ success: true });
});

app.post("/send-request", async (req, res) => {
  const { requesterId, targetUsername, amount } = req.body;
  const data = loadData();
  const targetId = data.usernames?.[targetUsername.toLowerCase()];

  if (!targetId) {
    return res.status(400).json({ error: "User not found" });
  }

  const requesterUsername = Object.keys(data.usernames || {}).find(
    username => data.usernames[username] == requesterId
  ) || "someone";

  const requestId = Date.now().toString();
  const miniAppUrl = `https://telepay-production.up.railway.app?to=${requesterUsername}&amount=${amount}&reqid=${requestId}`;

  const sendResult = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: targetId,
      text: `@${requesterUsername} is requesting ${amount} TON from you. Tap below to review and pay.`,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open to pay", web_app: { url: miniAppUrl } }],
          [{ text: "❌ Decline", callback_data: `declinereq:${requestId}` }]
        ]
      }
    })
  }).then(r => r.json());

  if (!data.pendingRequests) data.pendingRequests = {};
  data.pendingRequests[requestId] = {
    requesterId,
    requesterUsername,
    targetId,
    amount,
    chatId: targetId,
    messageId: sendResult.result.message_id
  };
  saveData(data);

  res.json({ success: true });
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

  const rawAddress = data.tonWallets?.[targetUserId];
  if (!rawAddress) {
    return res.status(404).json({ error: "This user hasn't connected a TON wallet yet" });
  }

  try {
    const formattedAddress = Address.parse(rawAddress).toString();
    res.json({ tonAddress: formattedAddress });
  } catch (error) {
    res.status(500).json({ error: "Invalid stored address" });
  }
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

app.get("/debug-usernames", (req, res) => {
  const data = loadData();
  res.json({ usernames: data.usernames });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});