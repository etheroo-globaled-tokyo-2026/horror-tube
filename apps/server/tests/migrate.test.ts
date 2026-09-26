import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readDatabaseCaCert } from "../src/db/database-ca.js";
import { readDatabaseUrl } from "../src/db/database-url.js";
import {
  connectionStringForVerifiedTls,
} from "../src/db/pg-client.js";
import {
  listMigrationFiles,
  migrationsDir,
  readMigrationSql,
} from "../src/db/migrate.js";

const packageRoot = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const samplePem = `-----BEGIN CERTIFICATE-----
MIIBozCCAUmgAwIBAgIUTestCertForUnitTestsOnlywDQYJKoZIhvcNAQELBQAw
ADAeFw0wMDAxMDEwMDAwMDBaFw0zMDAxMDEwMDAwMDBaMAAwXDANBgkqhkiG9w0B
AQEFAANLADBIAkEAuQexampleUnitTestPlaceholderOnlyNotARealKey000000
00000000000000000000000000000000000000000000000000000000000000000
wIDAQABMA0GCSqGSIb3DQEBCwUAA0EABQexample
-----END CERTIFICATE-----
`;

describe("DATABASE_URL", () => {
  it("throws and names DATABASE_URL when missing", () => {
    assert.throws(
      () => readDatabaseUrl({}),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /DATABASE_URL/u);
        assert.match(cause.message, /\.env\.example/u);
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

describe("DATABASE_CA_CERT", () => {
  it("throws and names DATABASE_CA_CERT when missing", () => {
    assert.throws(
      () => readDatabaseCaCert({}),
      /DATABASE_CA_CERT is required\. Set it in \.env\. See \.env\.example\./u,
    );
  });

  it("throws and names DATABASE_CA_CERT when blank", () => {
    assert.throws(
      () => readDatabaseCaCert({ DATABASE_CA_CERT: "  " }),
      /DATABASE_CA_CERT/u,
    );
  });

  it("accepts PEM text and dotenv-style escaped newlines", () => {
    const fromPem = readDatabaseCaCert({ DATABASE_CA_CERT: samplePem });
    assert.match(fromPem, /BEGIN CERTIFICATE/u);
    const escaped = samplePem.trimEnd().replace(/\n/gu, "\\n");
    const fromEscaped = readDatabaseCaCert({ DATABASE_CA_CERT: escaped });
    assert.equal(fromEscaped, fromPem);
  });

  it("accepts base64 of a PEM (DigitalOcean ca.certificate shape)", () => {
    const b64 = Buffer.from(samplePem, "utf8").toString("base64");
    const fromB64 = readDatabaseCaCert({ DATABASE_CA_CERT: b64 });
    assert.match(fromB64, /BEGIN CERTIFICATE/u);
  });

  it("rejects non-certificate material", () => {
    assert.throws(
      () => readDatabaseCaCert({ DATABASE_CA_CERT: "not-a-cert" }),
      /DATABASE_CA_CERT must be a PEM certificate/u,
    );
  });
});

describe("connectionStringForVerifiedTls", () => {
  it("strips sslmode so the CA ssl object is not overwritten", () => {
    const out = connectionStringForVerifiedTls(
      "postgres://u:p@host:25060/db?sslmode=require",
    );
    assert.doesNotMatch(out, /sslmode=/iu);
    assert.match(out, /^postgres:\/\//u);
    assert.match(out, /host/u);
  });
});

describe("migration SQL shape", () => {
  it("lists game-loop and battle-results migrations from the package migrations dir", async () => {
    const dir = migrationsDir();
    assert.equal(dir, join(packageRoot, "migrations"));
    const files = await listMigrationFiles(dir);
    assert.deepEqual(files, [
      "001_game_loop.sql",
      "002_battle_results.sql",
      "003_betting_closes_at.sql",
      "004_sui_pools.sql",
    ]);
  });

  it("defines the sui_pools ledger with the columns the pool store reads and writes", async () => {
    const sql = await readMigrationSql("004_sui_pools.sql");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS sui_pools/u);
    assert.match(sql, /battle_id text PRIMARY KEY/u);
    assert.match(sql, /pool_id text NOT NULL/u);
    assert.match(sql, /opened_at timestamptz NOT NULL DEFAULT now\(\)/u);
    assert.match(sql, /resolved_at timestamptz,/u);
    assert.match(sql, /resolution text,/u);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS schema_migrations/u);
  });

  it("defines seasons, rounds, votes, and tallies with ENS-label ids and tie-break", async () => {
    const sql = await readMigrationSql("001_game_loop.sql");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS seasons/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS rounds/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS votes/u);
    assert.match(sql, /CREATE TABLE IF NOT EXISTS tallies/u);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS schema_migrations/u);

    assert.match(sql, /champion_ens_label/u);
    assert.match(sql, /fighter_a_ens_label/u);
    assert.match(sql, /fighter_b_ens_label/u);
    assert.match(sql, /ens_label/u);
    assert.match(sql, /characters jsonb/u);

    assert.match(sql, /world_id_nullifier/u);
    assert.match(sql, /votes_round_nullifier_unique/u);
    assert.match(sql, /reached_at timestamptz NOT NULL/u);

    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS stakes/iu);
    assert.doesNotMatch(sql, /CREATE TABLE stakes/iu);
  });

  it("defines battle_results with gates and per-step tx hashes", async () => {
    const sql = await readMigrationSql("002_battle_results.sql");
    assert.match(sql, /CREATE TABLE IF NOT EXISTS battle_results/u);
    assert.match(sql, /battle_id text NOT NULL/u);
    assert.match(sql, /fighter_a_subname/u);
    assert.match(sql, /fighter_b_subname/u);
    assert.match(sql, /shots jsonb/u);
    assert.match(sql, /ens_line_loser/u);
    assert.match(sql, /ens_line_winner/u);
    assert.match(sql, /next_opponent_subname/u);
    assert.match(sql, /betting_closed boolean/u);
    assert.match(sql, /playback_finished boolean/u);
    assert.match(sql, /injuries_tx_hash/u);
    assert.match(sql, /status_tx_hash/u);
    assert.match(sql, /settlement_tx_hash/u);
    assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS schema_migrations/u);
  });
});

describe("migrate without DATABASE_URL", () => {
  it("fails before connecting when DATABASE_URL is missing", async () => {
    const { migrate } = await import("../src/db/migrate.js");
    await assert.rejects(
      () => migrate({}),
      (cause: unknown) => {
        assert.ok(cause instanceof Error);
        assert.match(cause.message, /DATABASE_URL/u);
        assert.match(cause.message, /\.env\.example/u);
        return true;
      },
    );
  });

  it("fails before connecting when DATABASE_CA_CERT is missing", async () => {
    const { migrate } = await import("../src/db/migrate.js");
    await assert.rejects(
      () =>
        migrate({
          DATABASE_URL: "postgres://user:pass@host/db",
        }),
      /DATABASE_CA_CERT/u,
    );
  });
});
