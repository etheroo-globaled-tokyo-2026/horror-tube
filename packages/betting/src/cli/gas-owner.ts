import { Transaction } from "@mysten/sui/transactions";
import { createClient, readNetwork, requiredEnv } from "../env.js";
import { succeeded } from "../execute.js";
import { gaslessWallet } from "./shinami.js";

const client = createClient({ network: readNetwork(), grpcUrl: requiredEnv("SUI_GRPC_URL") });
const wallet = await gaslessWallet(client, "horror-tube-gas-owner");
console.log(`Sending three gasless no-op transactions from ${wallet.address}…`);

const owners: string[] = [];
for (let run = 1; run <= 3; run += 1) {
  const tx = new Transaction();
  tx.moveCall({ target: "0x2::clock::timestamp_ms", arguments: [tx.object.clock()] });
  const digest = await wallet.run(tx);
  const { transaction } = succeeded(
    await client.core.getTransaction({ digest, include: { transaction: true } }),
  );
  const owner = transaction.gasData.owner;
  if (owner === null) throw new Error(`Transaction ${digest} has no gas owner.`);
  console.log(`${run}: ${digest} gas owner ${owner}`);
  owners.push(owner);
}

if (new Set(owners).size !== 1) {
  console.error(
    `Gas owners differ: ${owners.join(", ")}. The Move sponsor check needs one stable gas owner.`,
  );
  process.exit(1);
}
console.log(`\nAdd to .env:\nSUI_BET_SPONSOR=${owners[0]}`);
