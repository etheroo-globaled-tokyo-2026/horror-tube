import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseInjuriesTextRecord,
  type ChainWritePorts,
} from "@horror-tube/fight/battle-queue";
import {
  type Address,
  type Hex,
  createPublicClient,
  createWalletClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  isHex,
  parseAbi,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const ethRegistryAbi = parseAbi([
  "function getResolver(string label) view returns (address)",
]);
const permissionedResolverAbi = parseAbi([
  "function setText(bytes name, string key, string value)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
]);
const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

const PIN_MARKDOWN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ens/scripts/pin/sepolia-addresses.md",
);

function requiredSettleEnv(
  name: "AGENT_PRIVATE_KEY" | "SEPOLIA_RPC_URL" | "ENS_LABEL",
  env: NodeJS.ProcessEnv,
): string {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    throw new Error(
      `${name} is required. Set it in .env. See .env.example.`,
    );
  }
  return value.trim();
}

function parsePrivateKey(value: string, envName: string): Hex {
  const normalized = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(normalized) || normalized.length !== 66) {
    throw new Error(
      `${envName} must be a 32-byte hex string (0x + 64 hex chars). Got length ${String(normalized.length)}`,
    );
  }
  return normalized;
}

function loadAgentKey(env: NodeJS.ProcessEnv) {
  // The resolver rejects a key that lacks the status/injuries role.
  // PRIVATE_KEY stays off this process so the admin key is not deployed with the game.
  const privateKey = parsePrivateKey(
    requiredSettleEnv("AGENT_PRIVATE_KEY", env),
    "AGENT_PRIVATE_KEY",
  );
  return { privateKey, address: privateKeyToAccount(privateKey).address };
}

function parseEnsLabel(value: string): string {
  if (value.includes(".")) {
    throw new Error(
      `ENS_LABEL must be one label, not a full name. Got: ${value}`,
    );
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value)) {
    throw new Error(
      `ENS_LABEL must be a single lowercase DNS label (letters, digits, internal hyphens). Got: ${value}`,
    );
  }
  return value;
}

function loadEthRegistryAddress(): Address {
  let markdown: string;
  try {
    markdown = readFileSync(PIN_MARKDOWN_PATH, "utf8");
  } catch (cause) {
    throw new Error(
      `Failed to read pinned ENS address table at ${PIN_MARKDOWN_PATH}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  const match = /\|\s*ETHRegistry\s*\|\s*\[(0x[a-fA-F0-9]{40})\]/u.exec(markdown);
  if (match === null || match[1] === undefined) {
    throw new Error(
      `Pinned ENS address table is missing ETHRegistry: ${PIN_MARKDOWN_PATH}`,
    );
  }
  return getAddress(match[1]);
}

function characterName(subname: string, ensLabel: string): string {
  return `${subname}.${ensLabel}.eth`;
}

function dnsEncodeName(name: string): Hex {
  if (name === "") {
    return "0x00";
  }
  const labels = name.split(".");
  const bytes: number[] = [];
  for (const label of labels) {
    if (label === "") {
      throw new Error(`dnsEncodeName: empty label in name ${JSON.stringify(name)}`);
    }
    const encoded = new TextEncoder().encode(label);
    if (encoded.length === 0 || encoded.length > 255) {
      throw new Error(
        `dnsEncodeName: invalid label length ${String(encoded.length)} in ${name}`,
      );
    }
    bytes.push(encoded.length);
    bytes.push(...encoded);
  }
  bytes.push(0);
  return toHex(Uint8Array.from(bytes));
}

type EnsClients = {
  ensLabel: string;
  account: ReturnType<typeof privateKeyToAccount>;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
  resolver: Address;
};

async function openEnsClients(env: NodeJS.ProcessEnv): Promise<EnsClients> {
  const ensLabel = parseEnsLabel(requiredSettleEnv("ENS_LABEL", env));
  const rpcUrl = requiredSettleEnv("SEPOLIA_RPC_URL", env);
  const agentKey = loadAgentKey(env);
  const ethRegistry = loadEthRegistryAddress();
  const account = privateKeyToAccount(agentKey.privateKey);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(rpcUrl),
  });
  let resolverRaw: Address;
  try {
    resolverRaw = getAddress(
      await publicClient.readContract({
        address: ethRegistry,
        abi: ethRegistryAbi,
        functionName: "getResolver",
        args: [ensLabel],
      }),
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `ETHRegistry.getResolver(${ensLabel}) failed: ${detail}`,
      { cause },
    );
  }
  if (resolverRaw === ZERO_ADDRESS) {
    throw new Error(
      `Parent ${ensLabel}.eth has no resolver on ETHRegistry. Run character-subnames ensure first.`,
    );
  }
  return { ensLabel, account, publicClient, walletClient, resolver: resolverRaw };
}

async function readTextRecord(
  clients: EnsClients,
  dnsName: Hex,
  key: string,
  labelForError: string,
): Promise<string> {
  const data = encodeFunctionData({
    abi: textResolverAbi,
    functionName: "text",
    args: [ZERO_BYTES32, key],
  });
  let encoded: Hex;
  try {
    const resolved = await clients.publicClient.readContract({
      address: clients.resolver,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [dnsName, data],
    });
    // SAFETY: PermissionedResolver.resolve returns ABI-encoded bytes (Hex).
    encoded = resolved;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `PermissionedResolver.resolve(text ${key}) failed for ${labelForError}: ${detail}`,
      { cause },
    );
  }
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], encoded);
    return value;
  } catch (cause) {
    throw new Error(
      `Failed to decode text(${key}) resolve result for ${labelForError}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

async function readInjuriesText(
  clients: EnsClients,
  dnsName: Hex,
): Promise<string> {
  return readTextRecord(clients, dnsName, "injuries", "injuries");
}

export async function readRosterEnsStatuses(
  ensLabels: string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<string[]> {
  const clients = await openEnsClients(env);
  const statuses: string[] = [];
  for (const subname of ensLabels) {
    const name = characterName(subname, clients.ensLabel);
    const dnsName = dnsEncodeName(name);
    try {
      statuses.push(await readTextRecord(clients, dnsName, "status", name));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      throw new Error(
        `Failed to read ENS status for ${name}: ${detail}`,
        { cause },
      );
    }
  }
  return statuses;
}

async function setText(
  clients: EnsClients,
  dnsName: Hex,
  subname: string,
  key: string,
  value: string,
): Promise<string> {
  let hash: Hex;
  try {
    hash = await clients.walletClient.writeContract({
      account: clients.account,
      chain: sepolia,
      address: clients.resolver,
      abi: permissionedResolverAbi,
      functionName: "setText",
      args: [dnsName, key, value],
    });
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `PermissionedResolver.setText(${subname}, ${key}) failed: ${detail}`,
      { cause },
    );
  }
  console.log(
    `ENS setText sent label=${subname} key=${key} resolver=${clients.resolver} tx=${hash}`,
  );
  const receipt = await clients.publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(
      `PermissionedResolver.setText(${subname}, ${key}) tx reverted: ${hash}`,
    );
  }
  console.log(`ENS setText done label=${subname} key=${key} tx=${hash}`);
  return hash;
}

export function createEnsChainWritePorts(
  env: NodeJS.ProcessEnv = process.env,
): ChainWritePorts {
  return {
    async writeWinnerInjuries(args) {
      const clients = await openEnsClients(env);
      const name = characterName(args.subname, clients.ensLabel);
      const dnsName = dnsEncodeName(name);
      const current = await readInjuriesText(clients, dnsName);
      parseInjuriesTextRecord(current);
      return setText(
        clients,
        dnsName,
        args.subname,
        "injuries",
        JSON.stringify(args.injuries),
      );
    },
    async writeLoserStatusDead(args) {
      const clients = await openEnsClients(env);
      const name = characterName(args.subname, clients.ensLabel);
      const dnsName = dnsEncodeName(name);
      return setText(clients, dnsName, args.subname, "status", "dead");
    },
    async settleBattle(battleId) {
      throw new Error(
        `BattleBetting settlement is not implemented (battleId=${battleId}). Set SKIP_BATTLE_SETTLEMENT=1 until a settlement client exists. See .env.example.`,
      );
    },
  };
}
