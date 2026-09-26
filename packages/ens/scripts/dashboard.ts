import { config as loadDotenv } from "dotenv";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
  stringToBytes,
  toHex,
} from "viem";
import { sepolia } from "viem/chains";

import { ethRegistryAbi, permissionedResolverAbi, userRegistryAbi } from "./abis.js";
import { loadSubnamePinAddresses } from "./pin.js";

loadDotenv({ path: new URL("../../../.env", import.meta.url) });

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
const ZERO_BYTES32 =
  "0x0000000000000000000000000000000000000000000000000000000000000000" as const;
const STATUS_REGISTERED = 2;
export const REGISTER_SELECTOR = "0x85f3e643" as const;
export const TRANSFER_SINGLE_TOPIC0 =
  "0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62" as const;
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

const textResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
]);

export type CharacterSheet = {
  label: string;
  name: string;
  look: string;
  brief: string;
  injuries: string;
  status: string;
  icon: string;
};

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    fail(
      `${name} is required. Set it in .env. See .env.example. Refusing to fall back.`,
    );
  }
  return value.trim();
}

export function parseLabel(value: string | undefined): string {
  if (value === undefined || value.trim() === "") {
    fail(
      "ENS_LABEL is required. Set it in .env. See .env.example. Parent name is <ENS_LABEL>.eth; character subnames are label.<ENS_LABEL>.eth.",
    );
  }
  const trimmed = value.trim();
  if (trimmed.includes(".")) {
    fail(`ENS_LABEL must be one label, not a full name. Got: ${trimmed}`);
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(trimmed)) {
    fail(
      `ENS_LABEL must be a single lowercase DNS label (letters, digits, internal hyphens). Got: ${trimmed}`,
    );
  }
  return trimmed;
}

export const DASHBOARD_PORT = 8130;

export function parseDashboardPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return DASHBOARD_PORT;
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/u.test(trimmed)) {
    throw new Error(`DASHBOARD_PORT must be an integer port. Got: ${trimmed}`);
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(
      `DASHBOARD_PORT must be an integer port between 1 and 65535. Got: ${trimmed}`,
    );
  }
  return port;
}

export function parseListenerPids(stdout: string, selfPid: number): number[] {
  const pids: number[] = [];
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    if (!/^[0-9]+$/u.test(trimmed)) {
      throw new Error(`lsof listener line was not a pid. Got: ${JSON.stringify(trimmed)}`);
    }
    const pid = Number(trimmed);
    if (pid === selfPid) {
      continue;
    }
    pids.push(pid);
  }
  return pids;
}

function lsofListeners(port: number): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error === null) {
          resolvePromise(stdout);
          return;
        }
        const exitCode = "code" in error ? error.code : undefined;
        if (exitCode === 1) {
          resolvePromise(stdout);
          return;
        }
        const detail = stderr.trim() === "" ? error.message : stderr.trim();
        reject(new Error(`lsof failed for port ${port}: ${detail}`));
      },
    );
  });
}

function stopPid(pid: number, signal: NodeJS.Signals, port: number): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ESRCH") {
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to send ${signal} to pid ${pid} on port ${port}: ${detail}`,
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

async function waitUntilPortFree(port: number, attempts: number): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const stdout = await lsofListeners(port);
    if (parseListenerPids(stdout, process.pid).length === 0) {
      return true;
    }
    await delay(100);
  }
  return false;
}

export async function reclaimPort(port: number): Promise<number[]> {
  const stdout = await lsofListeners(port);
  const pids = parseListenerPids(stdout, process.pid);
  if (pids.length === 0) {
    return [];
  }
  for (const pid of pids) {
    stopPid(pid, "SIGTERM", port);
    console.error(`Sent SIGTERM to pid ${pid} listening on port ${port}`);
  }
  if (await waitUntilPortFree(port, 10)) {
    return pids;
  }
  const remaining = parseListenerPids(await lsofListeners(port), process.pid);
  for (const pid of remaining) {
    stopPid(pid, "SIGKILL", port);
    console.error(`Sent SIGKILL to pid ${pid} listening on port ${port}`);
  }
  if (await waitUntilPortFree(port, 10)) {
    return pids;
  }
  const left = parseListenerPids(await lsofListeners(port), process.pid);
  throw new Error(
    `Port ${port} still in use after SIGKILL. pid=${left.join(",")}`,
  );
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
      throw new Error(
        `dnsEncodeName: invalid label length ${encoded.length} in ${name}`,
      );
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

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderIconHtml(icon: string): string {
  if (icon === "") {
    return "<span>(empty)</span>";
  }
  if (icon.startsWith("https://")) {
    return `<img src="${escapeHtml(icon)}" alt="" width="100" height="100" />`;
  }
  return `<span>${escapeHtml(icon)}</span>`;
}

export function renderDashboardHtml(
  parentName: string,
  sheets: readonly CharacterSheet[],
): string {
  const cards = sheets
    .map((sheet) => {
      return [
        `<article class="sheet">`,
        `<h2>${escapeHtml(sheet.name)}</h2>`,
        `<dl>`,
        `<dt>look</dt><dd>${escapeHtml(sheet.look)}</dd>`,
        `<dt>brief</dt><dd>${escapeHtml(sheet.brief)}</dd>`,
        `<dt>injuries</dt><dd>${escapeHtml(sheet.injuries === "" ? "(empty)" : sheet.injuries)}</dd>`,
        `<dt>status</dt><dd class="status">${escapeHtml(sheet.status === "" ? "(empty)" : sheet.status)}</dd>`,
        `<dt>icon</dt><dd class="icon">${renderIconHtml(sheet.icon)}</dd>`,
        `</dl>`,
        `</article>`,
      ].join("\n");
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(parentName)} character sheets</title>
<style>
:root {
  --soot: #0c0806;
  --bone: #f2f2f8;
  --blood: #ff2b2b;
  --alive: #a6ff5c;
  --rust: #c9713a;
  --sulfur: #d9c35a;
  --char: #1c120c;
  --grime: #3a281c;
  --body: #c8c8dc;
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  background: var(--soot);
  color: var(--body);
  font-family: "DotGothic16", "Silkscreen", monospace;
  font-size: 15px;
  line-height: 1.45;
  padding: 2rem;
}
h1 {
  color: var(--bone);
  font-size: 1.75rem;
  margin-bottom: 0.35rem;
}
.meta {
  color: var(--sulfur);
  margin-bottom: 1.75rem;
}
.roster {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: repeat(auto-fill, minmax(18rem, 1fr));
}
.sheet {
  background: var(--char);
  border: 1px solid var(--grime);
  padding: 1rem 1.1rem;
}
.sheet h2 {
  color: var(--bone);
  font-size: 1.1rem;
  margin-bottom: 0.75rem;
}
dt {
  color: var(--rust);
  font-size: 0.75rem;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  margin-top: 0.55rem;
}
dd {
  color: var(--bone);
  white-space: pre-wrap;
  word-break: break-word;
}
dd.status { color: var(--alive); }
dd.icon img {
  display: block;
  margin-top: 0.35rem;
  image-rendering: pixelated;
}
</style>
</head>
<body>
<h1>${escapeHtml(parentName)}</h1>
<p class="meta">${sheets.length} registered character${sheets.length === 1 ? "" : "s"}</p>
<div class="roster">
${cards}
</div>
</body>
</html>
`;
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
        fromBlock,
        toBlock,
        topics: [TRANSFER_SINGLE_TOPIC0],
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
  const candidateLabels = new Set<string>();
  for (const hash of txHashes) {
    let tx: { input: Hex };
    try {
      tx = await publicClient.getTransaction({ hash });
    } catch (error) {
      throw new Error(
        `getTransaction(${hash}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const label = decodeRegisterLabel(tx.input);
    if (label !== null) {
      candidateLabels.add(label);
    }
  }

  if (candidateLabels.size === 0) {
    throw new Error(
      `No register() labels found in TransferSingle logs for ${subregistry} in blocks ${fromBlock.toString()}..${toBlock.toString()}`,
    );
  }

  const registered: string[] = [];
  for (const label of [...candidateLabels].sort()) {
    let status: number;
    try {
      status = Number(
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
    if (status === STATUS_REGISTERED) {
      registered.push(label);
    }
  }
  return registered;
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
  const sheets: CharacterSheet[] = [];
  for (const label of labels) {
    const name = subname(label, ensLabel);
    const dnsName = dnsEncodeName(name);
    const look = await readText(publicClient, resolver, dnsName, "look");
    const brief = await readText(publicClient, resolver, dnsName, "brief");
    const injuries = await readText(publicClient, resolver, dnsName, "injuries");
    const status = await readText(publicClient, resolver, dnsName, "status");
    const icon = await readText(publicClient, resolver, dnsName, "icon");
    sheets.push({ label, name, look, brief, injuries, status, icon });
  }
  return sheets;
}

export async function readRosterFromChain(
  ensLabel: string,
  rpcUrl: string,
): Promise<{ parentName: string; sheets: CharacterSheet[] }> {
  const pin = loadSubnamePinAddresses();
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(rpcUrl),
  });

  let subregistry: Address;
  let resolver: Address;
  try {
    const [sub, res] = await Promise.all([
      publicClient.readContract({
        address: pin.ETHRegistry,
        abi: ethRegistryAbi,
        functionName: "getSubregistry",
        args: [ensLabel],
      }),
      publicClient.readContract({
        address: pin.ETHRegistry,
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
    throw new Error(
      `Parent ${ensLabel}.eth has no resolver (getResolver returned zero address).`,
    );
  }

  const labels = await discoverRegisteredLabels(publicClient, subregistry);
  const sheets = await loadCharacterSheets(
    publicClient,
    ensLabel,
    subregistry,
    resolver,
    labels,
  );
  return { parentName: `${ensLabel}.eth`, sheets };
}

async function main(): Promise<void> {
  const ensLabel = parseLabel(process.env.ENS_LABEL);
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL");
  const portEnv = process.env.DASHBOARD_PORT;
  const port = parseDashboardPort(portEnv);
  const portSource =
    portEnv === undefined || portEnv.trim() === "" ? "fixed" : "DASHBOARD_PORT";

  const stopped = await reclaimPort(port);
  if (stopped.length > 0) {
    console.error(`Reclaimed port ${port} from pid ${stopped.join(",")}`);
  }

  const server = createServer((req, res) => {
    void (async () => {
      if (req.method !== "GET" || req.url !== "/") {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      try {
        const roster = await readRosterFromChain(ensLabel, rpcUrl);
        const html = renderDashboardHtml(roster.parentName, roster.sheets);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (error) {
        const message =
          error instanceof Error ? (error.stack ?? error.message) : String(error);
        console.error(`GET / chain read failed:\n${message}`);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(message);
      }
    })();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  console.log(`http://127.0.0.1:${port}/ (${portSource})`);
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  main().catch((error: unknown) => {
    fail(
      `Unhandled error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
  });
}
