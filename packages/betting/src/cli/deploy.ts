import { execFileSync } from "node:child_process";
import { Transaction } from "@mysten/sui/transactions";
import { z } from "zod";
import { createClient, readKeypair, readNetwork, readUnits, requiredEnv } from "../env.js";
import { createdId, execute, publishedPackageId } from "../execute.js";

const network = readNetwork();
const client = createClient({ network, grpcUrl: requiredEnv("SUI_GRPC_URL") });
const coinType = requiredEnv("SUI_USDC_TYPE");
const feeBps = readUnits("BET_FEE_BPS");
const minBet = readUnits("SUI_MIN_BET");
const sponsor = requiredEnv("SUI_BET_SPONSOR");
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");
const operator = readKeypair("SUI_OPERATOR_PRIVATE_KEY").toSuiAddress();

console.log(`Building move/ for ${network}…`);
const build = z.object({ modules: z.array(z.string()), dependencies: z.array(z.string()) }).parse(
  JSON.parse(
    execFileSync(
      "sui",
      ["move", "build", "--dump-bytecode-as-base64", "-e", network, "--path", "move"],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "inherit"],
      },
    ),
  ),
);

console.log(`Publishing from ${admin.toSuiAddress()}…`);
const publish = new Transaction();
publish.transferObjects([publish.publish(build)], admin.toSuiAddress());
const published = await execute(client, admin, publish);
const packageId = publishedPackageId(published);
const adminCap = createdId(published, "::betting::AdminCap");

console.log(`Creating the house (fee ${feeBps} bps, min bet ${minBet}, sponsor ${sponsor})…`);
const create = new Transaction();
create.moveCall({
  target: `${packageId}::betting::create_house`,
  typeArguments: [coinType],
  arguments: [
    create.object(adminCap),
    create.pure.u64(feeBps),
    create.pure.u64(minBet),
    create.pure.address(sponsor),
  ],
});
const houseId = createdId(await execute(client, admin, create), "::betting::House<");

async function issueCap(holder: string): Promise<string> {
  console.log(`Issuing an operator cap to ${holder}…`);
  const tx = new Transaction();
  const cap = tx.moveCall({
    target: `${packageId}::betting::issue_operator_cap`,
    typeArguments: [coinType],
    arguments: [tx.object(houseId), tx.object(adminCap)],
  });
  tx.transferObjects([cap], holder);
  return createdId(await execute(client, admin, tx), "::betting::OperatorCap");
}
const operatorCap = await issueCap(operator);
const e2eCap = await issueCap(admin.toSuiAddress());

console.log(`\nAdd to .env:
BETTING_PACKAGE_ID=${packageId}
BETTING_HOUSE_ID=${houseId}
SUI_ADMIN_CAP_ID=${adminCap}
SUI_OPERATOR_CAP_ID=${operatorCap}
SUI_E2E_OPERATOR_CAP_ID=${e2eCap}`);
