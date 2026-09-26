import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { assertEnvComplete } from "./check-env.js";
import { loadRepoDotenv } from "./env.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const loaded = loadRepoDotenv(repoRoot);
try {
  assertEnvComplete();
  console.log(`env: ok [${loaded.join(", ")}]`);
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}
