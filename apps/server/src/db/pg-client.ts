import pg from "pg";

import { readDatabaseCaCert } from "./database-ca.js";
import { readDatabaseUrl } from "./database-url.js";

const { Client } = pg;

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
export function createPgClient(
  env: NodeJS.ProcessEnv = process.env,
): pg.Client {
  const connectionString = connectionStringForVerifiedTls(readDatabaseUrl(env));
  const ca = readDatabaseCaCert(env);
  return new Client({
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
  });
}
