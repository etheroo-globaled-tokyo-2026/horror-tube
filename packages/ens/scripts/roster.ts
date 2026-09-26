import {
  type Address,
  type Hex,
  type PublicClient,
  createPublicClient,
  decodeAbiParameters,
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  stringToBytes,
  toHex,
} from "viem";
import { sepolia } from "viem/chains";

import { ethRegistryAbi, permissionedResolverAbi, userRegistryAbi } from "./abis.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const STATUS_REGISTERED = 2;
export const REGISTER_SELECTOR = "0x85f3e643" as const;
const transferSingleEvent = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
);
/** Inclusive block count per eth_getLogs window. Never larger than this. */
export const MAX_LOG_CHUNK_BLOCKS = 49999n;
/** Cap on backward windows from chain head. */
export const MAX_RECENT_LOG_CHUNKS = 4;
/** Lowest block number this dashboard will query. Never block 0. */
export const MIN_LOG_BLOCK = 1n;

export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

/**
 * Inclusive block windows walking backward from `latestBlock`.
 * Each window spans at most `maxChunkBlocks` blocks. Never includes block 0.
 */
export function recentLogScanChunks(
  latestBlock: bigint,
  maxChunks: number = MAX_RECENT_LOG_CHUNKS,
  maxChunkBlocks: bigint = MAX_LOG_CHUNK_BLOCKS,
): BlockRange[] {
  if (!Number.isInteger(maxChunks) || maxChunks < 1) {
    throw new Error(
      `recentLogScanChunks: maxChunks must be a positive integer. Got: ${String(maxChunks)}`,
    );
  }
  if (maxChunkBlocks < 1n) {
    throw new Error(
      `recentLogScanChunks: maxChunkBlocks must be >= 1. Got: ${maxChunkBlocks.toString()}`,
    );
  }
  if (latestBlock < MIN_LOG_BLOCK) {
    return [];
  }
  const chunks: BlockRange[] = [];
  let toBlock = latestBlock;
  for (let i = 0; i < maxChunks && toBlock >= MIN_LOG_BLOCK; i++) {
    let fromBlock = toBlock - (maxChunkBlocks - 1n);
    if (fromBlock < MIN_LOG_BLOCK) {
      fromBlock = MIN_LOG_BLOCK;
    }
    chunks.push({ fromBlock, toBlock });
    if (fromBlock <= MIN_LOG_BLOCK) {
      break;
    }
    toBlock = fromBlock - 1n;
  }
  return chunks;
}

const textResolverAbi = parseAbi(["function text(bytes32 node, string key) view returns (string)"]);

export type CharacterSheet = {
  label: string;
  name: string;
  owner: string;
  look: string;
  brief: string;
  injuries: string;
  status: string;
  icon: string;
};

function labelId(label: string): bigint {
  return BigInt(keccak256(stringToBytes(label)));
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
      throw new Error(`dnsEncodeName: invalid label length ${encoded.length} in ${name}`);
    }
    bytes.push(encoded.length);
    bytes.push(...encoded);
  }
  bytes.push(0);
  return toHex(Uint8Array.from(bytes));
}

function subname(label: string, ensLabel: string): string {
  return `${label}.${ensLabel}.eth`;
}

export function decodeRegisterLabel(input: Hex): string | null {
  const normalized = input.toLowerCase();
  if (!normalized.startsWith(REGISTER_SELECTOR)) {
    return null;
  }
  try {
    const decoded = decodeFunctionData({
      abi: userRegistryAbi,
      data: input,
    });
    if (decoded.functionName !== "register") {
      return null;
    }
    const label = decoded.args[0];
    if (typeof label !== "string") {
      return null;
    }
    return label;
  } catch {
    return null;
  }
}

async function collectRecentTransferSingleLogs(
  publicClient: PublicClient,
  address: Address,
): Promise<{
  logs: readonly { transactionHash: Hex }[];
  fromBlock: bigint;
  toBlock: bigint;
}> {
  const latestBlock = await publicClient.getBlockNumber();
  const planned = recentLogScanChunks(latestBlock);
  if (planned.length === 0) {
    throw new Error(
      `Cannot scan TransferSingle logs: latest block ${latestBlock.toString()} is below MIN_LOG_BLOCK ${MIN_LOG_BLOCK.toString()}`,
    );
  }

  console.error(
    `discover: subregistry=${address} latestBlock=${latestBlock.toString()} maxChunks=${String(MAX_RECENT_LOG_CHUNKS)} maxChunkBlocks=${MAX_LOG_CHUNK_BLOCKS.toString()}`,
  );

  const all: { transactionHash: Hex }[] = [];
  let seenAnyLog = false;
  let searchedFrom = planned[0]!.fromBlock;
  let searchedTo = planned[0]!.toBlock;

  for (const { fromBlock, toBlock } of planned) {
    searchedFrom = fromBlock < searchedFrom ? fromBlock : searchedFrom;
    searchedTo = toBlock > searchedTo ? toBlock : searchedTo;

    let chunk: readonly { transactionHash: Hex }[];
    try {
      chunk = await publicClient.getLogs({
        address,
        event: transferSingleEvent,
        fromBlock,
        toBlock,
      });
    } catch (error) {
      throw new Error(
        `eth_getLogs failed for ${address} fromBlock=${fromBlock.toString()} toBlock=${toBlock.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    console.error(
      `discover: eth_getLogs fromBlock=${fromBlock.toString()} toBlock=${toBlock.toString()} logs=${String(chunk.length)}`,
    );

    if (chunk.length > 0) {
      seenAnyLog = true;
      for (const log of chunk) {
        all.push({ transactionHash: log.transactionHash });
      }
    } else if (seenAnyLog) {
      break;
    }
  }

  return { logs: all, fromBlock: searchedFrom, toBlock: searchedTo };
}

async function discoverRegisteredLabels(
  publicClient: PublicClient,
  subregistry: Address,
): Promise<string[]> {
  const { logs, fromBlock, toBlock } = await collectRecentTransferSingleLogs(
    publicClient,
    subregistry,
  );
  const txHashes = [...new Set(logs.map((log) => log.transactionHash))];
  const inputs = await Promise.all(
    txHashes.map(async (hash) => {
      try {
        return (await publicClient.getTransaction({ hash })).input;
      } catch (error) {
        throw new Error(
          `getTransaction(${hash}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  const candidateLabels = new Set<string>();
  for (const input of inputs) {
    const label = decodeRegisterLabel(input);
    if (label !== null) {
      candidateLabels.add(label);
    }
  }

  if (candidateLabels.size === 0) {
    throw new Error(
      `No register() labels found in TransferSingle logs for ${subregistry} in blocks ${fromBlock.toString()}..${toBlock.toString()}`,
    );
  }

  const labels = [...candidateLabels].sort();
  const statuses = await Promise.all(
    labels.map(async (label) => {
      try {
        return Number(
          await publicClient.readContract({
            address: subregistry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [labelId(label)],
          }),
        );
      } catch (error) {
        throw new Error(
          `UserRegistry.getStatus(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }),
  );
  return labels.filter((_, i) => statuses[i] === STATUS_REGISTERED);
}

async function readText(
  publicClient: PublicClient,
  resolverAddress: Address,
  dnsName: Hex,
  key: string,
): Promise<string> {
  const data = encodeFunctionData({
    abi: textResolverAbi,
    functionName: "text",
    args: [ZERO_BYTES32, key],
  });
  let encoded: Hex;
  try {
    encoded = (await publicClient.readContract({
      address: resolverAddress,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [dnsName, data],
    })) as Hex;
  } catch (error) {
    throw new Error(
      `PermissionedResolver.resolve(text ${key}) failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const [value] = decodeAbiParameters([{ type: "string" }], encoded);
    return value;
  } catch (error) {
    throw new Error(
      `Failed to decode text(${key}) resolve result: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function loadCharacterSheets(
  publicClient: PublicClient,
  ensLabel: string,
  subregistry: Address,
  resolver: Address,
  labels: readonly string[],
): Promise<CharacterSheet[]> {
  return Promise.all(
    labels.map(async (label): Promise<CharacterSheet> => {
      const name = subname(label, ensLabel);
      const dnsName = dnsEncodeName(name);
      let owner: Address;
      try {
        const state = await publicClient.readContract({
          address: subregistry,
          abi: userRegistryAbi,
          functionName: "getState",
          args: [labelId(label)],
        });
        owner = getAddress(state.latestOwner);
      } catch (error) {
        throw new Error(
          `UserRegistry.getState(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const [look, brief, injuries, status, icon] = await Promise.all(
        ["look", "brief", "injuries", "status", "icon"].map((key) =>
          readText(publicClient, resolver, dnsName, key),
        ),
      );
      return { label, name, owner, look, brief, injuries, status, icon };
    }),
  );
}

/**
 * Browser-safe: no node imports. Concurrent reads go out as one Multicall3
 * call per tick and one JSON-RPC batch.
 */
export async function readRosterFromChain(
  ensLabel: string,
  rpcUrl: string,
  ethRegistry: Address,
): Promise<{ parentName: string; sheets: CharacterSheet[] }> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl, { batch: true }),
    batch: { multicall: true },
  });

  let subregistry: Address;
  let resolver: Address;
  try {
    const [sub, res] = await Promise.all([
      publicClient.readContract({
        address: ethRegistry,
        abi: ethRegistryAbi,
        functionName: "getSubregistry",
        args: [ensLabel],
      }),
      publicClient.readContract({
        address: ethRegistry,
        abi: ethRegistryAbi,
        functionName: "getResolver",
        args: [ensLabel],
      }),
    ]);
    subregistry = getAddress(sub);
    resolver = getAddress(res);
  } catch (error) {
    throw new Error(
      `Parent ETHRegistry read failed for ${ensLabel}.eth: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (subregistry === ZERO_ADDRESS) {
    throw new Error(
      `Parent ${ensLabel}.eth has no subregistry (getSubregistry returned zero address).`,
    );
  }
  if (resolver === ZERO_ADDRESS) {
    throw new Error(`Parent ${ensLabel}.eth has no resolver (getResolver returned zero address).`);
  }

  const labels = await discoverRegisteredLabels(publicClient, subregistry);
  const sheets = await loadCharacterSheets(publicClient, ensLabel, subregistry, resolver, labels);
  return { parentName: `${ensLabel}.eth`, sheets };
}
