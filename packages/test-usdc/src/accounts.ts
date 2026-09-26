import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, execute, readKeypair, readNetwork, requiredEnv } from "@horror-tube/betting";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { parseStructTag, parseToMist, parseToUnits } from "@mysten/sui/utils";

const USDC_DECIMALS = 6;
const usage =
  "Usage: pnpm test-usdc:accounts <count> <usdc-each> <sui-each>, e.g. 20 500 0.5 (whole coins, decimals allowed).";

const [rawCount, rawUsdc, rawSui] = process.argv.slice(2);
if (rawCount === undefined || rawUsdc === undefined || rawSui === undefined) throw new Error(usage);
if (!/^[1-9][0-9]*$/u.test(rawCount))
  throw new Error(`${JSON.stringify(rawCount)} is not a positive whole count. ${usage}`);
const count = Number(rawCount);
const usdcEach = parseToUnits(rawUsdc, USDC_DECIMALS);
const mistEach = parseToMist(rawSui);
if (usdcEach <= 0n || mistEach <= 0n) throw new Error(`Amounts must be above zero. ${usage}`);

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
}));
writeFileSync(accountsFile, `${JSON.stringify(accounts, null, 2)}\n`, { mode: 0o600 });
console.log(`Saved ${count} new keypairs to ${accountsFile}.`);

console.log(
  `Sending ${rawSui} SUI and ${rawUsdc} of ${coinType} to each, from ${admin.toSuiAddress()}…`,
);
const tx = new Transaction();
const suiCoins = tx.splitCoins(
  tx.gas,
  accounts.map(() => mistEach),
);
accounts.forEach(({ address }, index) => {
  tx.transferObjects([suiCoins[index]], address);
  tx.moveCall({
    target: `${parseStructTag(coinType).address}::usdc::mint_to`,
    arguments: [tx.object(faucetId), tx.pure.u64(usdcEach), tx.pure.address(address)],
  });
});
const funded = await execute(client, admin, tx);

console.log(`Funded in ${funded.digest}:\n${accounts.map(({ address }) => address).join("\n")}`);
