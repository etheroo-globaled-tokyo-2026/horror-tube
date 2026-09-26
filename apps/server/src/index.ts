import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { readGamePort, readStaticDir } from "./env.js";
import {
  readGameLoopConfig,
  readRosterEnsLabels,
} from "./game/config.js";
import { GameLoop } from "./game/loop.js";
import { createGameServer, listenGameServer } from "./server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env") });

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";
const game = new GameLoop({
  config: readGameLoopConfig(),
  ensLabels: readRosterEnsLabels(),
});

const server = createGameServer({ port, host, staticDir, game });
await listenGameServer(server, { port, host, staticDir, game });

const tickMs = 250;
setInterval(() => {
  game.tick();
}, tickMs);

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`) +
    ` · game loop quorum=${String(game.config.quorumVotes)} roster=${String(game.ensLabels.length)}`,
);
