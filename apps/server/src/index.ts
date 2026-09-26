import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRepoDotenv, readGamePort, readStaticDir } from "./env.js";
import { createGameServer, listenGameServer } from "./server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(join(repoRoot, ".env"));

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";

const server = createGameServer({ port, host, staticDir });
await listenGameServer(server, { port, host, staticDir });

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`),
);
