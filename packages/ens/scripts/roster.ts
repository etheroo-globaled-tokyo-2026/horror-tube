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
/** Inclusive block count per eth_getLogs window. Never larger than this (Infura max is 10000). */
export const MAX_LOG_CHUNK_BLOCKS = 10000n;
/** Cap on backward windows from chain head. */
export const MAX_RECENT_LOG_CHUNKS = 4;
/** Lowest block number this dashboard will query. Never block 0. */
export const MIN_LOG_BLOCK = 1n;
/** Attempts per eth_getTransactionByHash before giving up on 429. */
export const GET_TX_MAX_ATTEMPTS = 8;
/** First backoff after a 429, doubled each retry up to GET_TX_MAX_BACKOFF_MS. */
export const GET_TX_INITIAL_BACKOFF_MS = 500;
export const GET_TX_MAX_BACKOFF_MS = 16_000;
/** Pause between sequential getTransaction calls to stay under Infura rate limits. */
export const GET_TX_GAP_MS = 150;

export type BlockRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type SleepFn = (ms: number) => Promise<void>;

export async function defaultSleep(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** True when the RPC rejected the call for rate limiting (HTTP 429). */
export function isRateLimitError(error: unknown): boolean {
  if (error !== null && typeof error === "object" && "status" in error) {
    if ((error as { status: unknown }).status === 429) {
      return true;
    }
  }
  const msg = error instanceof Error ? error.message : String(error);
  return /\b429\b/.test(msg);
}

export type RateLimitRetryOptions = {
  sleep?: SleepFn;
  maxAttempts?: number;
  initialBackoffMs?: number;
  maxBackoffMs?: number;
};

/**
 * Run `fn` again after backoff when the RPC returns HTTP 429.
 * Non-429 errors are rethrown immediately (wrapped by the caller if needed).
 */
export async function withRateLimitRetry<T>(
  opLabel: string,
  fn: () => Promise<T>,
  options: RateLimitRetryOptions = {},
): Promise<T> {
  const sleep = options.sleep ?? defaultSleep;
  const maxAttempts = options.maxAttempts ?? GET_TX_MAX_ATTEMPTS;
  const initialBackoffMs = options.initialBackoffMs ?? GET_TX_INITIAL_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? GET_TX_MAX_BACKOFF_MS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error(
      `withRateLimitRetry: maxAttempts must be a positive integer. Got: ${String(maxAttempts)}`,
    );
  }
  let backoffMs = initialBackoffMs;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRateLimitError(error) || attempt === maxAttempts) {
        throw error;
      }
      console.error(
        `discover: ${opLabel} rate-limited (429), attempt ${String(attempt)}/${String(maxAttempts)}, waiting ${String(backoffMs)}ms`,
      );
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, maxBackoffMs);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/**
 * Sequential eth_getTransactionByHash with gap pacing and 429 backoff.
 * Does not switch RPC or invent labels.
 */
export async function fetchTransactionInputs(
  hashes: readonly Hex[],
  getTransaction: (args: { hash: Hex }) => Promise<{ input: Hex }>,
  options: RateLimitRetryOptions & { gapMs?: number } = {},
): Promise<Hex[]> {
  const sleep = options.sleep ?? defaultSleep;
  const gapMs = options.gapMs ?? GET_TX_GAP_MS;
  const inputs: Hex[] = [];
  for (let i = 0; i < hashes.length; i++) {
    const hash = hashes[i]!;
    if (i > 0 && gapMs > 0) {
      await sleep(gapMs);
    }
    try {
      const input = await withRateLimitRetry(
        `getTransaction(${hash})`,
        async () => (await getTransaction({ hash })).input,
        { ...options, sleep },
      );
      inputs.push(input);
    } catch (error) {
      throw new Error(
        `getTransaction(${hash}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  return inputs;
}

/**
 * Decode register() labels from transfer tx inputs and keep those still registered.
 * Used by discovery; injectable for unit tests (no live RPC).
 */
export async function labelsFromTransferTxHashes(
  txHashes: readonly Hex[],
  deps: {
    getTransaction: (args: { hash: Hex }) => Promise<{ input: Hex }>;
    getStatus: (label: string) => Promise<number>;
    sleep?: SleepFn;
    gapMs?: number;
  },
): Promise<string[]> {
  const inputs = await fetchTransactionInputs(txHashes, deps.getTransaction, {
    sleep: deps.sleep,
    gapMs: deps.gapMs,
  });
  const candidateLabels = new Set<string>();
  for (const input of inputs) {
    const label = decodeRegisterLabel(input);
    if (label !== null) {
      candidateLabels.add(label);
    }
  }
  if (candidateLabels.size === 0) {
    throw new Error(
      `No register() labels found in ${String(txHashes.length)} transfer transaction(s)`,
    );
  }
  const labels = [...candidateLabels].sort();
  const registered: string[] = [];
  for (const label of labels) {
    let status: number;
    try {
      status = await withRateLimitRetry(
        `getStatus(${label})`,
        () => deps.getStatus(label),
        { sleep: deps.sleep },
      );
    } catch (error) {
      throw new Error(
        `UserRegistry.getStatus(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (status === STATUS_REGISTERED) {
      registered.push(label);
    }
  }
  return registered;
}

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
  display_name: string;
  name: string;
  owner: string;
  look: string;
  brief: string;
  injury_places: string[];
  injuries: string[];
  status: string;
  icon: string;
};

type CharacterTexts = {
  display_name: string;
  look: string;
  brief: string;
  injury_places: string;
  injuries: string;
  status: string;
  icon: string;
};

export function parseStringList(
  label: string,
  key: string,
  raw: string,
  minimum: number,
): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${label}: ${key} must be a JSON array of non-empty strings. Got ${JSON.stringify(raw)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `${label}: ${key} must be a JSON array of non-empty strings. Got ${JSON.stringify(raw)}`,
    );
  }
  const items = parsed.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new Error(
        `${label}: ${key}[${String(index)}] must be a non-empty string. Got ${JSON.stringify(raw)}`,
      );
    }
    return item.trim();
  });
  if (items.length < minimum) {
    throw new Error(
      `${label}: ${key} must contain at least ${String(minimum)} entry. Got ${JSON.stringify(raw)}`,
    );
  }
  return items;
}

export function parseInjuries(label: string, raw: string): string[] {
  return parseStringList(label, "injuries", raw, 0);
}

export function parseInjuryPlaces(label: string, raw: string): string[] {
  return parseStringList(label, "injury_places", raw, 1);
}

export function characterSheetFromTexts(
  label: string,
  name: string,
  owner: string,
  texts: CharacterTexts,
): CharacterSheet {
  if (texts.display_name.trim() === "") {
    throw new Error(`${label}: display_name is missing or blank.`);
  }
  return {
    label,
    display_name: texts.display_name.trim(),
    name,
    owner,
    look: texts.look,
    brief: texts.brief,
    injury_places: parseInjuryPlaces(label, texts.injury_places),
    injuries: parseInjuries(label, texts.injuries),
    status: texts.status,
    icon: texts.icon,
  };
}

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
  latestBlock: bigint,
): Promise<{
  logs: readonly { transactionHash: Hex }[];
  fromBlock: bigint;
  toBlock: bigint;
}> {
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
  latestBlock: bigint,
): Promise<string[]> {
  const { logs, fromBlock, toBlock } = await collectRecentTransferSingleLogs(
    publicClient,
    subregistry,
    latestBlock,
  );
  const txHashes = [...new Set(logs.map((log) => log.transactionHash))];
  console.error(
    `discover: unique transfer txs=${String(txHashes.length)} (sequential getTransaction with 429 backoff)`,
  );
  try {
    return await labelsFromTransferTxHashes(txHashes, {
      getTransaction: (args) => publicClient.getTransaction(args),
      getStatus: async (label) =>
        Number(
          await publicClient.readContract({
            address: subregistry,
            abi: userRegistryAbi,
            functionName: "getStatus",
            args: [labelId(label)],
          }),
        ),
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.startsWith("No register() labels found")) {
      throw new Error(
        `No register() labels found in TransferSingle logs for ${subregistry} in blocks ${fromBlock.toString()}..${toBlock.toString()}`,
      );
    }
    throw error;
  }
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
    encoded = await withRateLimitRetry(`resolve(text ${key})`, async () =>
      (await publicClient.readContract({
        address: resolverAddress,
        abi: permissionedResolverAbi,
        functionName: "resolve",
        args: [dnsName, data],
      })) as Hex,
    );
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
  // Sequential per label: Infura rate-limits bursts of resolve/getState after getTransaction.
  const sheets: CharacterSheet[] = [];
  for (const label of labels) {
    const name = subname(label, ensLabel);
    const dnsName = dnsEncodeName(name);
    const readOwner = async (): Promise<Address> => {
      try {
        const state = await withRateLimitRetry(`getState(${label})`, async () =>
          publicClient.readContract({
            address: subregistry,
            abi: userRegistryAbi,
            functionName: "getState",
            args: [labelId(label)],
          }),
        );
        return getAddress(state.latestOwner);
      } catch (error) {
        throw new Error(
          `UserRegistry.getState(${label}) failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };
    const textKeys = [
      "display_name",
      "look",
      "brief",
      "injury_places",
      "injuries",
      "status",
      "icon",
    ] as const;
    const owner = await readOwner();
    const texts: string[] = [];
    for (const key of textKeys) {
      texts.push(await readText(publicClient, resolver, dnsName, key));
    }
    const [display_name, look, brief, injury_places, injuries, status, icon] = texts;
    sheets.push(
      characterSheetFromTexts(label, name, owner, {
        display_name,
        look,
        brief,
        injury_places,
        injuries,
        status,
        icon,
      }),
    );
  }
  return sheets;
}

/**
 * Browser-safe: no node imports. Contract reads may multicall; eth_getLogs and
 * eth_getTransaction stay unbatched. getTransaction is sequential with 429 backoff.
 */
export async function readRosterFromChain(
  ensLabel: string,
  rpcUrl: string,
  ethRegistry: Address,
): Promise<{ parentName: string; sheets: CharacterSheet[] }> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
    batch: { multicall: true },
  });

  const readParent = async (): Promise<[Address, Address]> => {
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
      return [getAddress(sub), getAddress(res)];
    } catch (error) {
      throw new Error(
        `Parent ETHRegistry read failed for ${ensLabel}.eth: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };
  const [[subregistry, resolver], latestBlock] = await Promise.all([
    readParent(),
    publicClient.getBlockNumber(),
  ]);

  if (subregistry === ZERO_ADDRESS) {
    throw new Error(
      `Parent ${ensLabel}.eth has no subregistry (getSubregistry returned zero address).`,
    );
  }
  if (resolver === ZERO_ADDRESS) {
    throw new Error(`Parent ${ensLabel}.eth has no resolver (getResolver returned zero address).`);
  }

  const labels = await discoverRegisteredLabels(publicClient, subregistry, latestBlock);
  const sheets = await loadCharacterSheets(publicClient, ensLabel, subregistry, resolver, labels);
  return { parentName: `${ensLabel}.eth`, sheets };
}

/** Registered subname labels only. Does not read text records. */
export async function readRegisteredLabels(
  ensLabel: string,
  rpcUrl: string,
  ethRegistry: Address,
): Promise<string[]> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
    batch: { multicall: true },
  });
  let subregistry: Address;
  try {
    subregistry = getAddress(
      await publicClient.readContract({
        address: ethRegistry,
        abi: ethRegistryAbi,
        functionName: "getSubregistry",
        args: [ensLabel],
      }),
    );
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
  let latestBlock: bigint;
  try {
    latestBlock = await publicClient.getBlockNumber();
  } catch (error) {
    throw new Error(
      `getBlockNumber failed while listing ${ensLabel}.eth subnames: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return discoverRegisteredLabels(publicClient, subregistry, latestBlock);
}
