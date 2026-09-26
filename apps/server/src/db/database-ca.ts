import { requiredEnv } from "@horror-tube/betting";

/**
 * DigitalOcean Managed Postgres project CA PEM (from GET .../databases/{id}/ca).
 * Accepts PEM text, dotenv-style `\\n` escapes, or the API's base64-wrapped PEM.
 */
export function readDatabaseCaCert(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const raw = requiredEnv("DATABASE_CA_CERT", env);
  let pem = raw.includes("\\n") ? raw.replace(/\\n/gu, "\n") : raw;
  if (!pem.includes("BEGIN CERTIFICATE")) {
    try {
      pem = Buffer.from(pem, "base64").toString("utf8").trim();
    } catch (cause) {
      throw new Error(
        `DATABASE_CA_CERT must be a PEM certificate (or base64 of that PEM). See .env.example.`,
        { cause },
      );
    }
  }
  if (!pem.includes("BEGIN CERTIFICATE") || !pem.includes("END CERTIFICATE")) {
    throw new Error(
      `DATABASE_CA_CERT must be a PEM certificate (BEGIN/END CERTIFICATE). See .env.example.`,
    );
  }
  return pem.endsWith("\n") ? pem : `${pem}\n`;
}
