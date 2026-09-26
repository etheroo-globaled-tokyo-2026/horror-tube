import pg from "pg";

import { readDatabaseCaCert } from "./database-ca.js";
import { readDatabaseUrl } from "./database-url.js";

const { Client, Pool } = pg;

// WARNING: node-pg lets a URI sslmode replace the `ssl` object, dropping the CA; strip it.
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

function verifiedTlsConfig(env: NodeJS.ProcessEnv) {
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

export function createPgPool(
  env: NodeJS.ProcessEnv = process.env,
): pg.Pool {
  const pool = new Pool(verifiedTlsConfig(env));
  pool.on("error", (err: Error) => {
    console.error(`Postgres pool error: ${err.message}`);
  });
  return pool;
}
