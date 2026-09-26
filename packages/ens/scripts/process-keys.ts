import { type Address, type Hex, getAddress, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export type ProcessRole = "roster" | "agent";

export type EnvMap = Record<string, string | undefined>;

export function requiredEnv(name: string, env: EnvMap = process.env): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example. Refusing to fall back.`,
    );
  }
  return value.trim();
}

export function parsePrivateKey(value: string, envName: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(
      `${envName} must be a 32-byte hex string (0x + 64 hex chars). Got length ${normalized.length}`,
    );
  }
  return normalized;
}

export function loadBootstrapKey(env: EnvMap = process.env): {
  privateKey: Hex;
  address: Address;
} {
  const privateKey = parsePrivateKey(requiredEnv("PRIVATE_KEY", env), "PRIVATE_KEY");
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

export function loadProcessKey(
  role: ProcessRole,
  env: EnvMap = process.env,
): {
  privateKey: Hex;
  address: Address;
  envName: string;
} {
  const envName = role === "roster" ? "ROSTER_PRIVATE_KEY" : "AGENT_PRIVATE_KEY";
  const privateKey = parsePrivateKey(requiredEnv(envName, env), envName);
  const address = privateKeyToAccount(privateKey).address;
  const bootstrap = loadBootstrapKey(env);
  if (getAddress(address) === getAddress(bootstrap.address)) {
    throw new Error(
      `${envName} resolves to the bootstrap/admin address ${bootstrap.address}. ` +
        `The ${role} process must use a restricted key, not PRIVATE_KEY. ` +
        `Set a distinct key in .env. See .env.example.`,
    );
  }
  return { privateKey, address, envName };
}

export function loadRosterKey(env: EnvMap = process.env) {
  return loadProcessKey("roster", env);
}

export function loadAgentKey(env: EnvMap = process.env) {
  return loadProcessKey("agent", env);
}
