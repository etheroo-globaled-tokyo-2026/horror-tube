import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadWorldIdEnv } from "@horror-tube/world-id";
import { assertDatabaseReady } from "./db/assert-database-ready.js";
import { readGamePort, readStaticDir } from "./env.js";
import { createGameServer, listenGameServer } from "./server.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadDotenv({ path: join(repoRoot, ".env") });

// Fail closed before listen: the waiver gate needs a signed World ID request.
loadWorldIdEnv();

const port = readGamePort();
const staticDir = readStaticDir();
const host = "0.0.0.0";

await assertDatabaseReady();
console.log("database: verified TLS connection ok");

const server = createGameServer({ port, host, staticDir });
await listenGameServer(server, { port, host, staticDir });

console.log(
  `horror-tube server listening on http://${host}:${String(port)}` +
    (staticDir === undefined ? " (API only; no STATIC_DIR)" : ` (static: ${staticDir})`),
);
