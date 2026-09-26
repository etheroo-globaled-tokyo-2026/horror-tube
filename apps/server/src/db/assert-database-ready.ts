import { createPgClient } from "./pg-client.js";

/**
 * Fail closed before the HTTP server listens: verified TLS + SELECT 1.
 * Uses DATABASE_URL and DATABASE_CA_CERT with rejectUnauthorized true.
 */
export async function assertDatabaseReady(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const client = createPgClient(env);
  try {
    await client.connect();
    const result = await client.query<{ ok: number }>("SELECT 1 AS ok");
    const ok = result.rows[0]?.ok;
    if (ok !== 1) {
      throw new Error(
        `Database boot check failed: expected SELECT 1 => 1, got ${JSON.stringify(ok)}.`,
      );
    }
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `Database boot check failed (verified TLS required). ${detail}`,
      { cause },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
