import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createPgClient } from "./pg-client.js";

export function migrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "migrations");
}

export async function listMigrationFiles(dir: string = migrationsDir()): Promise<string[]> {
  const names = await readdir(dir);
  return names
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));
}

export async function readMigrationSql(
  fileName: string,
  dir: string = migrationsDir(),
): Promise<string> {
  return readFile(join(dir, fileName), "utf8");
}

export type MigrateResult = {
  applied: string[];
  skipped: string[];
};

export async function migrate(
  env: NodeJS.ProcessEnv = process.env,
): Promise<MigrateResult> {
  const files = await listMigrationFiles();
  if (files.length === 0) {
    throw new Error(
      `No .sql migration files found in ${migrationsDir()}. Refusing to invent schema.`,
    );
  }

  const client = createPgClient(env);
  await client.connect();
  const applied: string[] = [];
  const skipped: string[] = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    for (const fileName of files) {
      const existing = await client.query<{ id: string }>(
        "SELECT id FROM schema_migrations WHERE id = $1",
        [fileName],
      );
      if (existing.rowCount !== null && existing.rowCount > 0) {
        skipped.push(fileName);
        continue;
      }
      const sql = await readMigrationSql(fileName);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (id) VALUES ($1)",
          [fileName],
        );
        await client.query("COMMIT");
        applied.push(fileName);
      } catch (cause) {
        await client.query("ROLLBACK");
        throw new Error(
          `Migration ${fileName} failed against DATABASE_URL. ${cause instanceof Error ? cause.message : String(cause)}`,
          { cause },
        );
      }
    }
  } finally {
    await client.end();
  }
  return { applied, skipped };
}
