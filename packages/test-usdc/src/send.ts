import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, execute, readNetwork, requiredEnv } from "@horror-tube/betting";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { isValidSuiAddress, normalizeSuiAddress } from "@mysten/sui/utils";
import { z } from "zod";

const usage =
  "Usage: pnpm test-usdc:send <account-index> <to-address> <units> (index is 1-based into packages/test-usdc/accounts.json; units are base units, 6 decimals).";

const [rawIndex, rawRecipient, rawUnits] = process.argv.slice(2);
if (rawIndex === undefined || rawRecipient === undefined || rawUnits === undefined)
  throw new Error(usage);
if (!/^[1-9][0-9]*$/u.test(rawIndex))
  throw new Error(`${JSON.stringify(rawIndex)} is not a positive account index. ${usage}`);
const recipient = normalizeSuiAddress(rawRecipient);
if (!isValidSuiAddress(recipient))
  throw new Error(`${JSON.stringify(rawRecipient)} is not a Sui address. ${usage}`);
if (!/^[1-9][0-9]*$/u.test(rawUnits))
  throw new Error(
    `${JSON.stringify(rawUnits)} is not a positive whole number of base units. ${usage}`,
  );
const units = BigInt(rawUnits);

const accountsFile = fileURLToPath(new URL("../accounts.json", import.meta.url));
const accounts = z
  .array(z.object({ address: z.string(), privateKey: z.string() }))
  .parse(JSON.parse(readFileSync(accountsFile, "utf8")));
const account = accounts[Number(rawIndex) - 1];
if (account === undefined)
  throw new Error(
    `Account ${rawIndex} is out of range: ${accountsFile} holds ${accounts.length} accounts.`,
  );
const sender = Ed25519Keypair.fromSecretKey(account.privateKey);
if (sender.toSuiAddress() !== normalizeSuiAddress(account.address))
  throw new Error(
    `Account ${rawIndex} in ${accountsFile}: the key does not match address ${account.address}.`,
  );

const client = createClient({ network: readNetwork(), grpcUrl: requiredEnv("SUI_GRPC_URL") });
const coinType = requiredEnv("TEST_USDC_TYPE");
const from = sender.toSuiAddress();

const usdc = async (owner: string): Promise<bigint> =>
  BigInt((await client.getBalance({ owner, coinType })).balance.addressBalance);
const held = await usdc(from);
if (held < units)
  throw new Error(
    `Account ${rawIndex} (${from}) holds ${held} base units of ${coinType} in its address balance; ${units} requested.`,
  );

const tx = new Transaction();
tx.setSender(from);
tx.moveCall({
  target: "0x2::coin::send_funds",
  typeArguments: [coinType],
  arguments: [
    coinWithBalance({ type: coinType, balance: units, useGasCoin: false }),
    tx.pure.address(recipient),
  ],
});
const sui = BigInt((await client.getBalance({ owner: from })).balance.balance);
try {
  await tx.build({ client });
} catch (error) {
  throw new Error(
    `Could not build the send from account ${rawIndex} (${from}, ${sui} MIST SUI for gas): ${error instanceof Error ? error.message : String(error)}`,
  );
}
const rawBudget = tx.getData().gasData.budget;
if (rawBudget === null || rawBudget === undefined)
  throw new Error(`Building the send from account ${rawIndex} (${from}) set no gas budget.`);
const budget = BigInt(rawBudget);
if (budget > sui)
  throw new Error(
    `Account ${rawIndex} (${from}) has ${sui} MIST SUI; the send needs a ${budget} MIST gas budget.`,
  );

console.log(
  `Sending ${units} base units of ${coinType} from account ${rawIndex} (${from}) to ${recipient}…`,
);
const sent = await execute(client, sender, tx);
console.log(`Done in ${sent.digest}.
${from} now holds ${await usdc(from)} base units in its address balance.
${recipient} now holds ${await usdc(recipient)} base units in its address balance.`);
