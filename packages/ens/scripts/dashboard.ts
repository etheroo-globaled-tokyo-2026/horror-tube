import { config as loadDotenv } from "dotenv";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSubnamePinAddresses } from "./pin.js";
import { type CharacterSheet, readRosterFromChain } from "./roster.js";

loadDotenv({ path: new URL("../../../.env", import.meta.url) });

export function ensAppUrl(name: string): string {
  return `https://app.ens.dev/${encodeURI(name)}`;
}

export function sepoliaAddressUrl(address: string): string {
  return `https://sepolia.etherscan.io/address/${address}`;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") {
    fail(`${name} is required. Set it in .env. See .env.example. Refusing to fall back.`);
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
    throw new Error(`DASHBOARD_PORT must be an integer port between 1 and 65535. Got: ${trimmed}`);
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
    throw new Error(`Failed to send ${signal} to pid ${pid} on port ${port}: ${detail}`);
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
  throw new Error(`Port ${port} still in use after SIGKILL. pid=${left.join(",")}`);
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

export function renderDashboardHtml(parentName: string, sheets: readonly CharacterSheet[]): string {
  const cards = sheets
    .map((sheet) => {
      return [
        `<article class="sheet">`,
        `<h2><a href="${escapeHtml(ensAppUrl(sheet.name))}">${escapeHtml(sheet.name)}</a></h2>`,
        `<p class="addr"><a href="${escapeHtml(sepoliaAddressUrl(sheet.owner))}">${escapeHtml(sheet.owner)}</a></p>`,
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
  margin-bottom: 0.35rem;
}
.sheet h2 a,
.addr a {
  color: var(--sulfur);
}
.addr {
  margin-bottom: 0.75rem;
  word-break: break-all;
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

async function main(): Promise<void> {
  const ensLabel = parseLabel(process.env.ENS_LABEL);
  const rpcUrl = requiredEnv("SEPOLIA_RPC_URL");
  const portEnv = process.env.DASHBOARD_PORT;
  const port = parseDashboardPort(portEnv);
  const portSource = portEnv === undefined || portEnv.trim() === "" ? "fixed" : "DASHBOARD_PORT";

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
        const roster = await readRosterFromChain(
          ensLabel,
          rpcUrl,
          loadSubnamePinAddresses().ETHRegistry,
        );
        const html = renderDashboardHtml(roster.parentName, roster.sheets);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (error) {
        const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
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
