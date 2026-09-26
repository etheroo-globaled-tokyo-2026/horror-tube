import { parseArgs } from "node:util";

export const DEFAULT_WALLET_ID = "horror-tube-cli-player";
const DEFAULT_TIMEOUT_MINUTES = 10;
const USDC_DECIMALS = 6;
const UNIT = 10n ** BigInt(USDC_DECIMALS);
const USDC_AMOUNT = new RegExp(`^([0-9]+)(?:\\.([0-9]{1,${USDC_DECIMALS}}))?$`, "u");

export const USAGE = `Usage: pnpm betting:player <game-url> <command> [--wallet <id>] [--timeout <minutes>]

Commands:
  address              Print the player's Shinami wallet address and its balance of the game's coin
  bet <A|B> <usdc>     Wait for a bout's bet phase with a pool, then bet <usdc> (like 1.5) on side A or B
  collect              Claim every finished ticket and print what each paid

Options:
  --wallet <id>        Shinami wallet id, default ${DEFAULT_WALLET_ID}; each id is its own player
  --timeout <minutes>  How long bet waits for the bet phase, default ${DEFAULT_TIMEOUT_MINUTES}

Fund the wallet with test USDC: pnpm test-usdc:mint <address> <units> (6 decimals: 2000000 is 2 USDC).
Reads SUI_NETWORK, SUI_GRPC_URL, SHINAMI_ACCESS_KEY and SUI_E2E_WALLET_SECRET from .env.`;

export type Side = 0 | 1;

export type PlayerCommand =
  | { name: "address" }
  | { name: "bet"; side: Side; units: bigint }
  | { name: "collect" };

export type PlayerArgs = {
  gameUrl: string;
  walletId: string;
  timeoutMs: number;
  command: PlayerCommand;
};

export function sideIndex(letter: string): Side {
  const upper = letter.toUpperCase();
  if (upper === "A") return 0;
  if (upper === "B") return 1;
  throw new Error(`Side must be A or B, got ${JSON.stringify(letter)}.`);
}

export const sideLetter = (side: bigint): "A" | "B" => (side === 0n ? "A" : "B");

export function parseUsdc(text: string): bigint {
  const match = USDC_AMOUNT.exec(text);
  if (match === null)
    throw new Error(
      `USDC amount must be a number with at most ${USDC_DECIMALS} decimals, like 1.5; got ${JSON.stringify(text)}.`,
    );
  const [, whole = "0", fraction = ""] = match;
  const units = BigInt(whole) * UNIT + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
  if (units === 0n)
    throw new Error(`USDC amount must be more than 0; got ${JSON.stringify(text)}.`);
  return units;
}

export function formatUsdc(units: bigint): string {
  const fraction = (units % UNIT).toString().padStart(USDC_DECIMALS, "0").replace(/0+$/u, "");
  const whole = (units / UNIT).toString();
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

function parseGameUrl(raw: string | undefined): string {
  if (raw === undefined) throw new Error("Missing <game-url>.");
  const url = URL.canParse(raw) ? new URL(raw) : null;
  if (url === null || (url.protocol !== "http:" && url.protocol !== "https:"))
    throw new Error(
      `${JSON.stringify(raw)} is not an http(s) game URL like http://localhost:8787.`,
    );
  return url.origin;
}

function parseTimeoutMs(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_TIMEOUT_MINUTES * 60_000;
  const minutes = Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error(`--timeout must be a positive number of minutes; got ${JSON.stringify(raw)}.`);
  return minutes * 60_000;
}

function parseCommand(name: string | undefined, rest: string[]): PlayerCommand {
  if (name === undefined) throw new Error("Missing <command>: address, bet or collect.");
  if (name === "bet") {
    const [letter, usdc, ...extra] = rest;
    if (letter === undefined || usdc === undefined) throw new Error("bet needs <A|B> <usdc>.");
    if (extra.length > 0) throw new Error(`bet takes <A|B> <usdc>; extra ${extra.join(" ")}.`);
    return { name, side: sideIndex(letter), units: parseUsdc(usdc) };
  }
  if (name !== "address" && name !== "collect")
    throw new Error(`Unknown command ${JSON.stringify(name)}: use address, bet or collect.`);
  if (rest.length > 0) throw new Error(`${name} takes no arguments; got ${rest.join(" ")}.`);
  return { name };
}

export function parsePlayerArgs(argv: string[]): PlayerArgs {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: { wallet: { type: "string" }, timeout: { type: "string" } },
  });
  const [gameUrl, name, ...rest] = positionals;
  const walletId = values.wallet?.trim() ?? DEFAULT_WALLET_ID;
  if (walletId === "") throw new Error("--wallet needs a wallet id.");
  return {
    gameUrl: parseGameUrl(gameUrl),
    walletId,
    timeoutMs: parseTimeoutMs(values.timeout),
    command: parseCommand(name, rest),
  };
}
