import "dotenv/config";

import { migrate } from "./db/migrate.js";

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
