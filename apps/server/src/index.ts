import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { cryptoRandomInt } from "@horror-tube/fight/rotation";
import { loadWorldIdEnv, readGateActions } from "@horror-tube/world-id";
import { assertDatabaseReady } from "./db/assert-database-ready.js";
import { loadRepoDotenv, readGamePort, readStaticDir } from "./env.js";
import { readGameLoopConfig, readRosterEnsLabels } from "./game/config.js";
import { GameLoop } from "./game/loop.js";
import { createGameServer, listenGameServer } from "./server.js";
import { createWalletHandlerFromEnv, failingWalletHandler } from "./wallet-handler.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(join(repoRoot, ".env"));

// Fail closed before listen: the waiver gate needs a signed World ID request.
loadWorldIdEnv();
readGateActions();

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";
const game = new GameLoop({
  config: readGameLoopConfig(),
  ensLabels: readRosterEnsLabels(),
  randomInt: cryptoRandomInt,
});

await assertDatabaseReady();
console.log("database: verified TLS connection ok");

let wallet;
try {
  wallet = createWalletHandlerFromEnv(process.env);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Wallet API is off. ${message}`);
  wallet = failingWalletHandler(message);
}

// Same pepper as the wallet session. Missing pepper fails POST /vote by name.
const pepperRaw = process.env.WALLET_SECRET_PEPPER;
const sessionPepper =
  pepperRaw !== undefined && pepperRaw.trim() !== ""
    ? pepperRaw.trim()
    : undefined;
if (sessionPepper === undefined) {
  console.error(
    "POST /vote will fail: WALLET_SECRET_PEPPER is required. Set it in .env. See .env.example.",
  );
}

const server = createGameServer({
  port,
  host,
  staticDir,
  wallet,
  game,
  sessionPepper,
});
await listenGameServer(server, {
  port,
  host,
  staticDir,
  wallet,
  game,
  sessionPepper,
});

const tickMs = 250;
setInterval(() => {
  game.tick();
}, tickMs);

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`) +
    ` · game loop quorum=${String(game.config.quorumVotes)} roster=${String(game.ensLabels.length)}`,
);
