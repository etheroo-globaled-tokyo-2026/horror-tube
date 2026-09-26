import { randomInt } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, execute, readKeypair, readNetwork, requiredEnv } from "@horror-tube/betting";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { parseStructTag, parseToMist } from "@mysten/sui/utils";

const USDC_UNIT = 1_000_000n;
const MAX_MINT = 1_000n * USDC_UNIT;
const usage =
  "Usage: pnpm test-usdc:accounts <count> <usdc-min> <usdc-max> <sui-each>, e.g. 20 500 2000 0.02 (whole USDC; SUI decimals allowed). Each account gets a random whole USDC amount in the range.";

const [rawCount, rawMin, rawMax, rawSui] = process.argv.slice(2);
if (rawCount === undefined || rawMin === undefined || rawMax === undefined || rawSui === undefined)
  throw new Error(usage);
for (const raw of [rawCount, rawMin, rawMax])
  if (!/^[1-9][0-9]*$/u.test(raw)) throw new Error(`${JSON.stringify(raw)} is not a positive whole number. ${usage}`);
const count = Number(rawCount);
const usdcMin = Number(rawMin);
const usdcMax = Number(rawMax);
if (usdcMin > usdcMax) throw new Error(`usdc-min ${usdcMin} is above usdc-max ${usdcMax}. ${usage}`);
const mistEach = parseToMist(rawSui);
if (mistEach <= 0n) throw new Error(`sui-each must be above zero. ${usage}`);

const accountsFile = fileURLToPath(new URL("../accounts.json", import.meta.url));
if (existsSync(accountsFile))
  throw new Error(
    `${accountsFile} already holds accounts. Move or delete it to create new ones; this CLI never overwrites keys.`,
  );

const client = createClient({ network: readNetwork(), grpcUrl: requiredEnv("SUI_GRPC_URL") });
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const coinType = requiredEnv("TEST_USDC_TYPE");
const faucetId = requiredEnv("TEST_USDC_FAUCET_ID");

const accounts = Array.from({ length: count }, () => Ed25519Keypair.generate()).map((keypair) => ({
  address: keypair.toSuiAddress(),
  privateKey: keypair.getSecretKey(),
  usdc: randomInt(usdcMin, usdcMax + 1),
}));
writeFileSync(accountsFile, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
console.log(`Saved ${count} new keypairs to ${accountsFile}.`);

console.log(
  `Sending ${rawSui} SUI and ${usdcMin}–${usdcMax} of ${coinType} to each, from ${admin.toSuiAddress()}…`,
);
const tx = new Transaction();
const suiCoins = tx.splitCoins(
  tx.gas,
  accounts.map(() => mistEach),
);
accounts.forEach(({ address, usdc }, index) => {
  tx.transferObjects([suiCoins[index]], address);
  for (let left = BigInt(usdc) * USDC_UNIT; left > 0n; left -= left > MAX_MINT ? MAX_MINT : left)
    tx.moveCall({
      target: `${parseStructTag(coinType).address}::usdc::mint_to`,
      arguments: [tx.object(faucetId), tx.pure.u64(left > MAX_MINT ? MAX_MINT : left), tx.pure.address(address)],
    });
});
const funded = await execute(client, admin, tx);

console.log(
  `Funded in ${funded.digest}:\n${accounts.map(({ address, usdc }) => `${address}  ${usdc} USDC`).join("\n")}`,
);
