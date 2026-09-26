import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readDatabaseUrl } from "../src/db/database-url.js";
import {
  listMigrationFiles,
  migrationsDir,
  readMigrationSql,
} from "../src/db/migrate.js";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

describe("DATABASE_URL", () => {
  it("throws and names DATABASE_URL when missing", () => {
    assert.throws(
      () => readDatabaseUrl({}),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /DATABASE_URL/u);
        assert.match(err.message, /\.env\.example/u);
        return true;
      },
    );
  });

  it("throws and names DATABASE_URL when blank", () => {
    assert.throws(
      () => readDatabaseUrl({ DATABASE_URL: "  " }),
      /DATABASE_URL is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("returns a trimmed non-empty URL", () => {
    assert.equal(
      readDatabaseUrl({ DATABASE_URL: "postgres://user:pass@host/db" }),
      "postgres://user:pass@host/db",
    );
  });
});

describe("migration SQL shape", () => {
  it("lists 001_game_loop.sql from the package migrations dir", async () => {
    const dir = migrationsDir();
    assert.equal(dir, join(packageRoot, "migrations"));
    const files = await listMigrationFiles(dir);
    assert.deepEqual(files, ["001_game_loop.sql"]);
  });

  it("defines seasons, rounds, votes, and tallies with ENS-label ids and tie-break", async () => {
    const sql = await readMigrationSql("001_game_loop.sql");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS seasons/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS rounds/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS votes/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS tallies/u);

    assert.match(sql, /champion_ens_label/u);
    assert.match(sql, /fighter_a_ens_label/u);
    assert.match(sql, /fighter_b_ens_label/u);
    assert.match(sql, /ens_label/u);
    assert.match(sql, /characters jsonb/u);
    assert.match(sql, /holding copy/iu);
    assert.match(sql, /bet window reads it/u);
    assert.match(sql, /on-chain settle finishes on Sui/u);
    assert.match(sql, /then write ENS text record `status`/u);
    assert.match(sql, /Do not write ENS before settlement/u);
    assert.match(sql, /Do not treat this row as what pays out/u);
    assert.doesNotMatch(sql, /Settle writes ENS first/u);
    assert.doesNotMatch(sql, /BattleBetting settle reads ENS/u);
    assert.doesNotMatch(
      sql,
      /Character alive\/kills\/damage live on seasons\.characters/u,
    );

    assert.match(sql, /world_id_nullifier/u);
    assert.match(sql, /votes_round_nullifier_unique/u);
    assert.match(sql, /reached_at timestamptz NOT NULL/u);

    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS stakes/iu);
    assert.doesNotMatch(sql, /CREATE TABLE stakes/iu);
  });

  it("keeps the checked-in migration file readable as UTF-8 SQL", async () => {
    const path = join(packageRoot, "migrations", "001_game_loop.sql");
    const raw = await readFile(path, "utf8");
    assert.ok(raw.includes("CREATE TABLE"));
    assert.ok(!raw.includes("<<<<<<<"));
  });
});

describe("migrate without DATABASE_URL", () => {
  it("fails before connecting when DATABASE_URL is missing", async () => {
    const { migrate } = await import("../src/db/migrate.js");
    await assert.rejects(
      () => migrate({}),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.match(err.message, /DATABASE_URL/u);
        assert.match(err.message, /\.env\.example/u);
        return true;
      },
    );
  });
});
