import { config as loadDotenv } from "dotenv";
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
  parseAbiItem,
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
const transferSingleEvent = parseAbiItem(
  "event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)",
);

export function isPrunedHistoricalStateError(message: string): boolean {
  return /historical state|missing trie node|state pruned|history has been pruned/iu.test(
    message,
  );
}
const LOG_CHUNK_SIZE = 40000n;

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

export function parseDashboardPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    fail(
      "DASHBOARD_PORT is required. Set it in .env. See .env.example. Refusing to fall back.",
    );
  }
  const trimmed = value.trim();
  if (!/^[0-9]+$/u.test(trimmed)) {
    fail(`DASHBOARD_PORT must be an integer port. Got: ${trimmed}`);
  }
  const port = Number(trimmed);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail(`DASHBOARD_PORT must be an integer port between 1 and 65535. Got: ${trimmed}`);
  }
  return port;
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

async function hasBytecodeAt(
  publicClient: PublicClient,
  address: Address,
  blockNumber: bigint,
): Promise<boolean> {
  try {
    const code = await publicClient.getBytecode({ address, blockNumber });
    return code !== undefined && code !== "0x";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPrunedHistoricalStateError(message)) {
      return false;
    }
    throw new Error(
      `getBytecode(${address}, block ${blockNumber.toString()}) failed: ${message}`,
    );
  }
}

export async function findContractBirthBlock(
  publicClient: PublicClient,
  address: Address,
): Promise<bigint> {
  const latest = await publicClient.getBlockNumber();
  const latestHasCode = await hasBytecodeAt(publicClient, address, latest);
  if (!latestHasCode) {
    throw new Error(
      `Subregistry ${address} has no bytecode at latest block ${latest.toString()}`,
    );
  }
  let lo = 0n;
  let hi = latest;
  while (lo < hi) {
    const mid = (lo + hi) / 2n;
    if (await hasBytecodeAt(publicClient, address, mid)) {
      hi = mid;
    } else {
      lo = mid + 1n;
    }
  }
  return lo;
}

async function historicalStateAvailable(
  publicClient: PublicClient,
  address: Address,
  blockNumber: bigint,
): Promise<boolean> {
  try {
    await publicClient.getBytecode({ address, blockNumber });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPrunedHistoricalStateError(message)) {
      return false;
    }
    throw new Error(
      `getBytecode(${address}, block ${blockNumber.toString()}) failed: ${message}`,
    );
  }
}

export async function findTransferLogStartBlock(
  publicClient: PublicClient,
  address: Address,
): Promise<bigint> {
  const birthBlock = await findContractBirthBlock(publicClient, address);
  if (birthBlock === 0n) {
    return 0n;
  }
  const priorAvailable = await historicalStateAvailable(
    publicClient,
    address,
    birthBlock - 1n,
  );
  if (priorAvailable) {
    return birthBlock;
  }

  console.error(
    `discover: getBytecode birthBlock=${birthBlock.toString()} is at the RPC state frontier; walking TransferSingle logs backward`,
  );
  let start = birthBlock;
  let cursor = birthBlock;
  while (cursor > 0n) {
    const from = cursor > LOG_CHUNK_SIZE ? cursor - LOG_CHUNK_SIZE : 0n;
    const to = cursor - 1n;
    const logs = await getLogsChunked(publicClient, address, from, to);
    if (logs.length === 0) {
      break;
    }
    start = from;
    cursor = from;
  }
  return start;
}

async function getLogsChunked(
  publicClient: PublicClient,
  address: Address,
  fromBlock: bigint,
  toBlock: bigint,
): Promise<readonly { transactionHash: Hex }[]> {
  if (fromBlock > toBlock) {
    return [];
  }
  try {
    return await publicClient.getLogs({
      address,
      event: transferSingleEvent,
      fromBlock,
      toBlock,
    });
  } catch (error) {
    if (fromBlock === toBlock) {
      throw new Error(
        `eth_getLogs failed for ${address} at block ${fromBlock.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const mid = (fromBlock + toBlock) / 2n;
    const left = await getLogsChunked(publicClient, address, fromBlock, mid);
    const right = await getLogsChunked(publicClient, address, mid + 1n, toBlock);
    return [...left, ...right];
  }
}

async function collectTransferSingleLogs(
  publicClient: PublicClient,
  address: Address,
  birthBlock: bigint,
  latestBlock: bigint,
): Promise<readonly { transactionHash: Hex }[]> {
  const all: { transactionHash: Hex }[] = [];
  let start = birthBlock;
  while (start <= latestBlock) {
    let end = start + LOG_CHUNK_SIZE - 1n;
    if (end > latestBlock) {
      end = latestBlock;
    }
    const chunk = await getLogsChunked(publicClient, address, start, end);
    for (const log of chunk) {
      all.push({ transactionHash: log.transactionHash });
    }
    start = end + 1n;
  }
  return all;
}

async function discoverRegisteredLabels(
  publicClient: PublicClient,
  subregistry: Address,
): Promise<string[]> {
  const logStartBlock = await findTransferLogStartBlock(publicClient, subregistry);
  const latestBlock = await publicClient.getBlockNumber();
  console.error(
    `discover: subregistry=${subregistry} logStartBlock=${logStartBlock.toString()} latestBlock=${latestBlock.toString()}`,
  );
  const logs = await collectTransferSingleLogs(
    publicClient,
    subregistry,
    logStartBlock,
    latestBlock,
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
  const port = parseDashboardPort(process.env.DASHBOARD_PORT);

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

  console.log(`http://127.0.0.1:${port}/`);
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
