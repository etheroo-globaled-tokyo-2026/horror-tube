import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRepoDotenv } from "./env.js";
import { migrate } from "./db/migrate.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(repoRoot);

async function main(): Promise<void> {
  const result = await migrate();
  console.log(
    JSON.stringify({
      ok: true,
      applied: result.applied,
      skipped: result.skipped,
    }),
  );
}

main().catch((cause: unknown) => {
  const message = cause instanceof Error ? cause.message : String(cause);
  console.error(message);
  process.exitCode = 1;
});
