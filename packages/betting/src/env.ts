import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
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

export function readNetwork(env: NodeJS.ProcessEnv = process.env): BettingConfig["network"] {
  return z.enum(["testnet", "mainnet"]).parse(requiredEnv("SUI_NETWORK", env));
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

export function readKeypair(name: string, env: NodeJS.ProcessEnv = process.env): Ed25519Keypair {
  return Ed25519Keypair.fromSecretKey(requiredEnv(name, env));
}

export function createClient(config: Pick<BettingConfig, "network" | "grpcUrl">): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl });
}
