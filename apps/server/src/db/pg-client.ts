import pg from "pg";

import { readDatabaseCaCert } from "./database-ca.js";
import { readDatabaseUrl } from "./database-url.js";

const { Client, Pool } = pg;

/**
 * Drop libpq sslmode from the URI so node-pg does not replace our `ssl` object
 * with a bare enable flag (which drops the CA and fails DO's chain).
 */
export function connectionStringForVerifiedTls(databaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch (cause) {
    throw new Error(
      `DATABASE_URL is not a valid URL. See .env.example.`,
      { cause },
    );
  }
  url.searchParams.delete("sslmode");
  url.searchParams.delete("ssl");
  url.searchParams.delete("uselibpqcompat");
  return url.toString();
}

/**
 * Postgres client that verifies TLS with the DigitalOcean project CA.
 * Rejects missing DATABASE_URL / DATABASE_CA_CERT. Never disables verification.
 */
function verifiedTlsConfig(env: NodeJS.ProcessEnv): {
  connectionString: string;
  ssl: { ca: string; rejectUnauthorized: true };
} {
  return {
    connectionString: connectionStringForVerifiedTls(readDatabaseUrl(env)),
    ssl: {
      ca: readDatabaseCaCert(env),
      rejectUnauthorized: true,
    },
  };
}

export function createPgClient(
  env: NodeJS.ProcessEnv = process.env,
): pg.Client {
  return new Client(verifiedTlsConfig(env));
}

/**
 * Long-lived pool for the game process. An idle connection drop is logged
 * on the pool; a single Client with no listener would take the process down.
 */
export function createPgPool(
  env: NodeJS.ProcessEnv = process.env,
): pg.Pool {
  const pool = new Pool(verifiedTlsConfig(env));
  pool.on("error", (err: Error) => {
    console.error(`Postgres pool error: ${err.message}`);
  });
  return pool;
}
