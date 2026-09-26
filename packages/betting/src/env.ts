import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey, SUI_PRIVATE_KEY_PREFIX } from "@mysten/sui/cryptography";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { z } from "zod";

export type ContractIds = { packageId: string; houseId: string; coinType: string };
export type BettingConfig = ContractIds & { network: "testnet" | "mainnet"; grpcUrl: string };

export function requiredEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (value === undefined || value === "")
    throw new Error(`${name} is required. Set it in .env. See .env.example.`);
  return value;
}

const Network = z.enum(["testnet", "mainnet"]);

export function readNetwork(env: NodeJS.ProcessEnv = process.env): BettingConfig["network"] {
  const raw = requiredEnv("SUI_NETWORK", env);
  const parsed = Network.safeParse(raw);
  if (!parsed.success)
    throw new Error(
      `SUI_NETWORK must be one of ${Network.options.map((o) => JSON.stringify(o)).join(", ")}. Got ${JSON.stringify(raw)}. Set it in .env. See .env.example.`,
    );
  return parsed.data;
}

export function readBettingConfig(env: NodeJS.ProcessEnv = process.env): BettingConfig {
  return {
    network: readNetwork(env),
    grpcUrl: requiredEnv("SUI_GRPC_URL", env),
    packageId: requiredEnv("BETTING_PACKAGE_ID", env),
    houseId: requiredEnv("BETTING_HOUSE_ID", env),
    coinType: requiredEnv("SUI_USDC_TYPE", env),
  };
}

export function readUnits(name: string, env: NodeJS.ProcessEnv = process.env): bigint {
  const raw = requiredEnv(name, env);
  if (!/^[0-9]+$/u.test(raw))
    throw new Error(`${name} must be a whole number. Got ${JSON.stringify(raw)}.`);
  return BigInt(raw);
}

// WARNING: the SDK's decode errors echo the key string. Replace them; never chain them as `cause`.
export function readKeypair(name: string, env: NodeJS.ProcessEnv = process.env): Ed25519Keypair {
  const raw = requiredEnv(name, env);
  const fail = (reason: string): never => {
    throw new Error(
      `${name} ${reason}. Expected an Ed25519 ${SUI_PRIVATE_KEY_PREFIX}1… key. Set it in .env. See .env.example.`,
    );
  };
  if (!raw.startsWith(`${SUI_PRIVATE_KEY_PREFIX}1`))
    return fail(`does not start with ${SUI_PRIVATE_KEY_PREFIX}1`);
  let decoded: ReturnType<typeof decodeSuiPrivateKey>;
  try {
    decoded = decodeSuiPrivateKey(raw);
  } catch {
    return fail("is not valid bech32 (bad characters, length, or checksum)");
  }
  if (decoded.scheme !== "ED25519") return fail(`is a ${String(decoded.scheme)} key, not ED25519`);
  if (decoded.secretKey.length !== 32)
    return fail(`decodes to ${decoded.secretKey.length} secret-key bytes, not 32`);
  return Ed25519Keypair.fromSecretKey(decoded.secretKey);
}

export function createClient(config: Pick<BettingConfig, "network" | "grpcUrl">): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
}
