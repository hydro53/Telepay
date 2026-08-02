const { TonClient } = require("@ton/ton");

const client = new TonClient({
  endpoint: "https://testnet.toncenter.com/api/v2/jsonRPC",
});

async function checkBalance(address) {
  const balance = await client.getBalance(address);
  console.log("Balance (nanotons):", balance.toString());
}

checkBalance("0QBmeEbTXtyzLT8BvbVyXxqOqogeeI-RXhtZQ0g03Z51c5bd");