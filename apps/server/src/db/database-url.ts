import { requiredEnv } from "../env.js";

export function readDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return requiredEnv("DATABASE_URL", env).trim();
}
