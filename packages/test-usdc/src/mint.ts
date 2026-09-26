import { createClient, execute, readKeypair, readNetwork, requiredEnv } from "@horror-tube/betting";
import { Transaction } from "@mysten/sui/transactions";
import { isValidSuiAddress, normalizeSuiAddress, parseStructTag } from "@mysten/sui/utils";

const [rawRecipient, rawUnits] = process.argv.slice(2);
const usage = "Usage: pnpm test-usdc:mint <address> <units> (units are base units, 6 decimals).";
if (rawRecipient === undefined || rawUnits === undefined) throw new Error(usage);
const recipient = normalizeSuiAddress(rawRecipient);
if (!isValidSuiAddress(recipient))
  throw new Error(`${JSON.stringify(rawRecipient)} is not a Sui address. ${usage}`);
if (!/^[0-9]+$/u.test(rawUnits))
  throw new Error(`${JSON.stringify(rawUnits)} is not a whole number of base units. ${usage}`);
const units = BigInt(rawUnits);

const client = createClient({ network: readNetwork(), grpcUrl: requiredEnv("SUI_GRPC_URL") });
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const coinType = requiredEnv("TEST_USDC_TYPE");
const faucetId = requiredEnv("TEST_USDC_FAUCET_ID");

console.log(`Minting ${units} base units of ${coinType} to ${recipient}…`);
const tx = new Transaction();
tx.moveCall({
  target: `${parseStructTag(coinType).address}::usdc::mint_to`,
  arguments: [tx.object(faucetId), tx.pure.u64(units), tx.pure.address(recipient)],
});
const minted = await execute(client, admin, tx);

const { balance } = await client.getBalance({ owner: recipient, coinType });
console.log(`Done in ${minted.digest}.
${recipient} now holds ${balance.addressBalance} base units in its address balance (${balance.balance} in total).`);
