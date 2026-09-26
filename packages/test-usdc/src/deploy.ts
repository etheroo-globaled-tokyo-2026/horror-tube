import { execFileSync } from "node:child_process";
import {
  createClient,
  createdId,
  execute,
  publishedPackageId,
  readKeypair,
  readNetwork,
  requiredEnv,
} from "@horror-tube/betting";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_COIN_REGISTRY_OBJECT_ID } from "@mysten/sui/utils";
import { z } from "zod";

const network = readNetwork();
if (network !== "testnet")
  throw new Error(`SUI_NETWORK is ${network}. Test USDC is testnet-only; set SUI_NETWORK=testnet.`);
const client = createClient({ network, grpcUrl: requiredEnv("SUI_GRPC_URL") });
const admin = readKeypair("SUI_ADMIN_PRIVATE_KEY");

console.log(`Building move/ for ${network}…`);
const build = z
  .object({ modules: z.array(z.string()), dependencies: z.array(z.string()) })
  .parse(
    JSON.parse(
      execFileSync(
        "sui",
        ["move", "build", "--dump-bytecode-as-base64", "-e", network, "--path", "move"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
      ),
    ),
  );

console.log(`Publishing from ${admin.toSuiAddress()}…`);
const publish = new Transaction();
publish.transferObjects([publish.publish(build)], admin.toSuiAddress());
const published = await execute(client, admin, publish);
const packageId = publishedPackageId(published);
const faucetId = createdId(published, "::usdc::Faucet");
const currencyId = createdId(published, "::coin_registry::Currency<");
const coinType = `${packageId}::usdc::USDC`;

console.log(`Registering ${coinType} in the coin registry…`);
const register = new Transaction();
register.moveCall({
  target: "0x2::coin_registry::finalize_registration",
  typeArguments: [coinType],
  arguments: [register.object(SUI_COIN_REGISTRY_OBJECT_ID), register.object(currencyId)],
});
await execute(client, admin, register);

console.log(`\nAdd to .env:
TEST_USDC_TYPE=${coinType}
TEST_USDC_FAUCET_ID=${faucetId}`);
