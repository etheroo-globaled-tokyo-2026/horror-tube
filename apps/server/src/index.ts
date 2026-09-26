import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorldIdEnv } from "@horror-tube/world-id";
import { readGamePort, readStaticDir } from "./env.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "./game/config.js";
import { GameLoop } from "./game/loop.js";
import { createGameServer, listenGameServer } from "./server.js";
import { createWalletHandlerFromEnv, failingWalletHandler } from "./wallet-handler.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env") });

// Fail closed before listen: the waiver gate needs a signed World ID request.
loadWorldIdEnv();

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";
const game = new GameLoop({
  config: readGameLoopConfig(),
  ensLabels: readRosterEnsLabels(),
});

let wallet;
try {
  wallet = createWalletHandlerFromEnv(process.env);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Wallet API is off. ${message}`);
  wallet = failingWalletHandler(message);
}

const server = createGameServer({ port, host, staticDir, wallet, game });
await listenGameServer(server, { port, host, staticDir, wallet, game });

const tickMs = 250;
setInterval(() => {
  game.tick();
}, tickMs);

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`) +
    ` · game loop quorum=${String(game.config.quorumVotes)} roster=${String(game.ensLabels.length)}`,
);
