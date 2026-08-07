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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});