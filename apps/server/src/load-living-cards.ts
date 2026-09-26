import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { LivingCard } from "@horror-tube/fight";
import {
  type Address,
  type Hex,
  createPublicClient,
  decodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  parseAbi,
  toHex,
} from "viem";
import { sepolia } from "viem/chains";

import { requiredEnv } from "./env.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;

const ethRegistryAbi = parseAbi([
  "function getResolver(string label) view returns (address)",
]);
const permissionedResolverAbi = parseAbi([
  "function resolve(bytes name, bytes data) view returns (bytes)",
]);
const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

const PIN_MARKDOWN_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/ens/scripts/pin/sepolia-addresses.md",
);

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

function parseInjuriesJson(subname: string, raw: string): string[] {
  if (raw.trim() === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${subname}: injuries must be a JSON array of strings. Got ${JSON.stringify(raw)}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${subname}: injuries must be a JSON array of strings. Got ${JSON.stringify(raw)}.`,
    );
  }
  return parsed.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(
        `${subname}: injuries[${String(index)}] must be a non-empty string.`,
      );
    }
    return item.trim();
  });
}

async function readText(
  publicClient: ReturnType<typeof createPublicClient>,
  resolver: Address,
  dnsName: Hex,
  key: string,
  subname: string,
): Promise<string> {
  const data = encodeFunctionData({
    abi: textResolverAbi,
    functionName: "text",
    args: [ZERO_BYTES32, key],
  });
  let encoded: Hex;
  try {
    encoded = await publicClient.readContract({
      address: resolver,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [dnsName, data],
    });
  } catch (cause) {
    throw new Error(
      `PermissionedResolver.resolve(text ${key}) failed for ${subname}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], encoded);
    return value;
  } catch (cause) {
    throw new Error(
      `Failed to decode text(${key}) for ${subname}: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
}

/**
 * Read look/brief/injuries/status for each subname from Sepolia ENS.
 * Fail closed on missing ENS_LABEL / SEPOLIA_RPC_URL, a blank look/brief, or a
 * status that is `dead` or not a known value.
 */
export async function loadLivingCardsFromEns(
  subnames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<LivingCard[]> {
  if (subnames.length === 0) {
    throw new Error("loadLivingCardsFromEns requires at least one subname.");
  }
  const ensLabel = parseEnsLabel(requiredEnv("ENS_LABEL", env));
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL", env);
  const ethRegistry = loadEthRegistryAddress();
  const publicClient = createPublicClient({
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
    throw new Error(
      `ETHRegistry.getResolver(${ensLabel}) failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause },
    );
  }
  if (resolverRaw === ZERO_ADDRESS) {
    throw new Error(
      `Parent ${ensLabel}.eth has no resolver on ETHRegistry.`,
    );
  }

  const cards: LivingCard[] = [];
  for (const subname of subnames) {
    const trimmed = subname.trim();
    if (trimmed === "") {
      throw new Error("loadLivingCardsFromEns: blank subname.");
    }
    const dnsName = dnsEncodeName(`${trimmed}.${ensLabel}.eth`);
    const [look, brief, injuriesRaw, statusRaw] = await Promise.all([
      readText(publicClient, resolverRaw, dnsName, "look", trimmed),
      readText(publicClient, resolverRaw, dnsName, "brief", trimmed),
      readText(publicClient, resolverRaw, dnsName, "injuries", trimmed),
      readText(publicClient, resolverRaw, dnsName, "status", trimmed),
    ]);
    if (look.trim() === "") {
      throw new Error(
        `${trimmed}: look text record is blank. Refusing to narrate without a look.`,
      );
    }
    if (brief.trim() === "") {
      throw new Error(
        `${trimmed}: brief text record is blank. Refusing to narrate without a brief.`,
      );
    }
    // Blank status means never fought; the ENS roster scripts treat it as living too.
    const status = statusRaw.trim();
    if (status === "dead") {
      throw new Error(
        `${trimmed}: ENS status is dead. Fight job requires a living card.`,
      );
    }
    if (status !== "" && status !== "alive") {
      throw new Error(
        `${trimmed}: ENS status must be "alive", "dead", or blank. Got ${JSON.stringify(statusRaw)}.`,
      );
    }
    cards.push({
      subname: trimmed,
      look: look.trim(),
      brief: brief.trim(),
      injuries: parseInjuriesJson(trimmed, injuriesRaw),
      status: "alive",
    });
  }
  return cards;
}
