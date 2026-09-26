import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { loadRepoDotenv } from "./env.js";
import { migrate } from "./db/migrate.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
loadRepoDotenv(join(repoRoot, ".env"));

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

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(message);
  process.exitCode = 1;
});
